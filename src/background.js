const isFirefox = typeof InstallTrigger !== 'undefined';
const browser = isFirefox && window.browser || window.chrome;
const domParser = new DOMParser();

window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
const DB_NAME = 'HistoryAsBookmarksDB';
const STORE_NAME = 'history';
const ___LAST_TIME_HISTORY_BEING_INDEXED___ = '___LAST_TIME_HISTORY_BEING_INDEXED___';
const ___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER___ = '___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER___';
let   ___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER_ID___ = null;
const HALF_YEAR_AGO = Date.now() - 180 * 24 * 60 * 60 * 1000;
let searchTimer;

const currentOmniboxSuggestionsDescriptionToUrlMap = (_ => {
    const data = new Map();
    return {
        add: (desc, url) => {
            if(!data.has(desc)) {
                data.set(desc, new Set());
            }
            data.get(desc).add(url);
        },
        get: desc => data.get(desc) || new Set(),
        clearAll: () => data.clear()
    }
})();

const dbPromise = new Promise(resolve => {
    const dbRequest = window.indexedDB.open(DB_NAME, 1);

    dbRequest.onupgradeneeded = function (ev){
        const db = dbRequest.result;
        db.createObjectStore(STORE_NAME);
    }

    dbRequest.onsuccess = function (ev){
        const db = dbRequest.result;

        const getObjectStore = (mode = 'readonly') => {
            const transaction = db.transaction([STORE_NAME], mode);
            return transaction.objectStore(STORE_NAME);
        }

        const closeDb = () => db.close();

        const insertDb = (value, key) => {
            const store = getObjectStore('readwrite');
            const getRequest = store.get(IDBKeyRange.only(key));
            getRequest.onsuccess = function (result){
                if(!getRequest.result) store.add(value, key);
            }
        }

        const updateDb = (value, key) => {
            const store = getObjectStore('readwrite');
            store.put(value, key);
        }

        const deleteFromDb = url => {
            const store = getObjectStore('readwrite');
            store.delete(IDBKeyRange.only(url));
        }

        const saveHistoryAndBookmarks = () => {
            const store = getObjectStore('readwrite');
            const saveDbAndBookmarks = (item, existingBookmarks) => {
                addItemIntoBookmarkFolder(item.url, item.title, ___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER_ID___, existingBookmarks);
                insertDb(item, item.url);
            }
            store.get(___LAST_TIME_HISTORY_BEING_INDEXED___).onsuccess = async function (ev){
                const lastIndexTimeResult = ev.target.result
                if(!lastIndexTimeResult){
                    store.clear();
                    const duplicateCheck = new Set();
                    const histories = await getHistorySince(HALF_YEAR_AGO);
                    const existingBookmarks = await getAllBookmarks();
                    histories.forEach(ht => {
                        if(!duplicateCheck.has(ht.url)){
                            duplicateCheck.add(ht.url);
                            if(!ht.title) { ht.title = ht.url; }
                            saveDbAndBookmarks(ht, existingBookmarks);
                        }
                    })
                    existingBookmarks.forEach(bm => {
                        if(!duplicateCheck.has(bm.url)){
                            duplicateCheck.add(bm.url);
                            if(!bm.title) { bm.title = bm.url; }
                            insertDb(bm, bm.url);
                        }
                    })
                    updateDb(Date.now(), ___LAST_TIME_HISTORY_BEING_INDEXED___);
                } else {
                    getHistorySince(Number(lastIndexTimeResult))
                        .then(values => values.forEach(saveDbAndBookmarks))
                        .then(_ => updateDb(Date.now(), ___LAST_TIME_HISTORY_BEING_INDEXED___));
                }
            }
        }

        const saveHistoryPeriodically = interval => {
            setTimeout(() => {
                saveHistoryAndBookmarks();
                saveHistoryPeriodically(interval);
            }, interval);
        }

        const searchFromDbByPage = (keyword, startCursorIndex = 0, size) => {
           return new Promise(res => {
               const words = keyword.toUpperCase().split(/[ ]+/);
               const store = getObjectStore('readonly');
               const req = store.openCursor();
               let isBeforeCursorAdvanced = true;
               let traverseCounter = 0;
               const searchResults = [];

               req.onsuccess = function (event){
                   const cursor = event.target.result;
                   if(traverseCounter === size || !cursor) {
                       return res(searchResults);
                   }

                   if(isBeforeCursorAdvanced && startCursorIndex > 0){
                       isBeforeCursorAdvanced = false;
                       cursor.advance(startCursorIndex);
                   } else {
                       traverseCounter++;
                       const value = cursor.value;
                       const url = value.url && value.url.toUpperCase() || '' ;
                       const title = value.title && value.title.toUpperCase() || '';
                       const text = `${url} ${title}`;
                       if(words.every(w => text.includes(w))){
                           searchResults.push(value)
                       }
                       cursor.continue();
                   }
               }
           })
        }

        const searchFromDb = (keyword, threads = 1) => {
            return new Promise(res => {
                const store = getObjectStore('readonly');
                const reqCount = store.count();
                const pages = threads;
                reqCount.onsuccess = function (evt){
                    const totalSize = evt.target.result || 0;
                    const eachPageSize = Math.ceil(totalSize/pages);
                    const promises = [];
                    for (let i = 0; i < pages; i++) {
                        const size =  Math.min(totalSize - eachPageSize * i, eachPageSize);
                        promises.push(searchFromDbByPage(keyword, eachPageSize * i, size));
                    }
                    const consolidation = [];
                    Promise.all(promises)
                        .then(arrOfArr => arrOfArr.forEach(arr => consolidation.push(...arr)))
                        .then(() => res(consolidation));
                }
            });
        }

        // create a folder in bookmark manager
        tryCreateHistoryBookmarkFolder(___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER___)
            .then(folderId => ___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER_ID___ = folderId)
            .then(_ => {
                // save history and bookmarks first saving and do periodically.
                saveHistoryAndBookmarks();
                saveHistoryPeriodically(10 * 60 * 1000);
        });

        resolve({ saveHistoryAndBookmarks, searchFromDb, deleteFromDb, closeDb });
    }
})

browser.omnibox.onInputStarted.addListener(ev => {
    dbPromise.then(({saveHistoryAndBookmarks}) => saveHistoryAndBookmarks());
})

browser.omnibox.onInputChanged.addListener((text, suggest) => {
    if(!text || text.length < 2){
        return suggest([]);
    }
    clearTimeout(searchTimer);
    const DEBOUNCE_TIME = 300;
    const THREADS = 3;
    searchTimer = setTimeout(() => doSearch(text, suggest, THREADS), DEBOUNCE_TIME);
});

browser.omnibox.onInputEntered.addListener((url, disposition) => {
    switch (disposition) {
        case "currentTab":
            browser.tabs.update({url});
            break;
        case "newForegroundTab":
            browser.tabs.create({url});
            break;
        case "newBackgroundTab":
            browser.tabs.create({url, active: false});
            break;
    }
});

browser.omnibox.onDeleteSuggestion && (browser.omnibox.onDeleteSuggestion.addListener(text => {
    // only chrome support this API
    // text is the description part of the suggestion item, a map from description to url saved in currentOmniboxSuggestionsDescriptionToUrlMap.
    const urlList = Array.from(currentOmniboxSuggestionsDescriptionToUrlMap.get(text));
    urlList.forEach(url => {
        deleteHistory(url);
        deleteBookmark(url);
        dbPromise.then(({deleteFromDb}) => deleteFromDb(url));
    });
}))

function doSearch(text, suggest, threads = 1){
    const map = new Map();

    const apply = (items = []) => {
        currentOmniboxSuggestionsDescriptionToUrlMap.clearAll();
        items.filter(item => item.url)
            .map(item => {
                const {url, title} = item;
                const description = `${encodeXml(title)}  -  <url>${encodeXml(url)}</url>`
                const key = title? `${title}  -  ${url}`: `-  ${url}`;
                currentOmniboxSuggestionsDescriptionToUrlMap.add(key , url);
                return {content: url, description, deletable: true };
            })
            .filter(item => isValidXml(item.description))
            .forEach(item => map.set(item.content, item));
    }
    return dbPromise.then(({searchFromDb}) => {
        searchFromDb(text, threads)
            .then(data => {
                data.sort((a, b) => {
                    if(a.visitCount === undefined) a.visitCount = 1;
                    if(b.visitCount === undefined) b.visitCount = 1;
                    return b.visitCount - a.visitCount;
                })
                return data;
            })
            .then(apply)
            .then(_ => suggest(Array.from(map.values())));
    })
}

function getHistorySince(startTime= 0){
    return new Promise(resolve => searchThruHistory('', resolve, startTime, Math.pow(10, 6)));
}

function searchThruHistory(keyword, callback,  startTime = 0, maxResults = 100){
    return new Promise(resolve => {
        const map = new Map();
        const cb = results => {
            results.filter(item => !(item.url.includes("www.google.com") && item.url.includes("/search?q=")))
                    .filter(item => !(item.url.includes('www.baidu.com/s?')))
                    .forEach(item => map.set(item.url, item));
            const filtered = Array.from(map.values());
            filtered.sort((a, b) => b.visitCount - a.visitCount);
            callback(filtered);
            resolve();
        }
        const rtn =  browser.history.search({'text': keyword, startTime, maxResults}, cb);
        if(isFirefox && rtn instanceof Promise){
            rtn.then(cb);
        }
    })
}

function getAllBookmarks(){
    return new Promise(resolve => {
        const map = new Map();
        const loopNodes = (bookmarkTreeNodeArr = []) => {
            for(let node of bookmarkTreeNodeArr){
                if(!node.children && node.url){
                    const {id, url, tile, dateAdded} = node;
                    map.set(url, {id, url, tile, dateAdded});
                } else {
                    loopNodes(node.children);
                }
            }
        }

        browser.bookmarks.getTree(nodes => {
            loopNodes(nodes);
            resolve(Array.from(map.values()));
        });
    })
}

function searchThruBookmark(keyword, callback){
    return new Promise(resolve => {
        const cb = results => {
            callback(results);
            resolve();
        }
        const rtn =  browser.bookmarks.search(keyword, cb);
        if(isFirefox && rtn instanceof Promise){
            rtn.then(cb);
        }
    })
}

function getBookmark(url){
    return new Promise(resolve => {
        browser.bookmarks.search({url}, nodes => {
            if(nodes && nodes.length > 0) resolve(nodes[0]);
            else resolve(null);
        });
    })
}

function deleteBookmark(url){
    browser.bookmarks.search({url}, nodes => nodes.forEach(n => browser.bookmarks.remove(n.id)));
}

function deleteHistory(url){
    browser.history.deleteUrl({url});
}

function tryCreateHistoryBookmarkFolder(name){
    return new Promise(resolve => {
        searchThruBookmark({title: name}, nodeArr => {
            if(!nodeArr || nodeArr.length === 0){
                browser.bookmarks.create({title: name}, node => resolve(node.id));
            } else {
                resolve(nodeArr[0].id);
            }
        })
    })
}

async function addItemIntoBookmarkFolder(url, title, folderId, existingBookmarks){
    if(!folderId || !url){
        console.warn('url and parent folderId required when creating bookmark.')
        return Promise.reject();
    }
    if(existingBookmarks && Array.isArray(existingBookmarks)){
        const found = existingBookmarks.find(bm => url === bm.url);
        if(found){
           return Promise.resolve(found.id);
        }
    } else {
       const found = await getBookmark(url)
       if(found){
           return Promise.resolve(found.id);
       }
    }

    return new Promise(resolve => {
        browser.bookmarks.create({url, title, parentId: folderId}, node => resolve(node.id));
    })
}

function encodeXml(s) {
    const holder = document.createElement('div');
    holder.textContent = s;
    return holder.innerHTML;
}

function isValidXml(s){
    const root = domParser.parseFromString(
        '<fragment>' + s + '</fragment>', 'text/xml');
    const error = root.querySelector('parsererror div');
    return !error;
}