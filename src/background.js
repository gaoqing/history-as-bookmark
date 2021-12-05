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

const dbPromise = new Promise(resolve => {
    const dbRequest = window.indexedDB.open(DB_NAME, 1);

    dbRequest.onupgradeneeded = function (ev){
        const db = dbRequest.result;
        db.createObjectStore(STORE_NAME);
    }

    dbRequest.onsuccess = function (ev){
        const db = dbRequest.result;
        const closeDb = () => db.close();
        const getStore = (mode = 'readonly') => {
            const transaction = db.transaction([STORE_NAME], mode);
            return transaction.objectStore(STORE_NAME);
        }

        const insertDb = (value, key) => {
            const objectStore = getStore('readwrite');
            const getRequest = objectStore.get(IDBKeyRange.only(key));
            getRequest.onsuccess = function (result){
                if(!getRequest.result){
                    objectStore.add(value, key);
                }
            }
        }

        const updateDb = (value, key) => {
            const objectStore = getStore('readwrite');
            objectStore.put(value, key);
        }

        const saveHistoryAndBookmarks = () => {
            const store = getStore('readwrite');
            const saveDbAndBookmarks = item => {
                addItemInHistoryBookmarkFolder(item.url, item.title || item.url, ___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER_ID___);
                insertDb(item, item.url);
            }
            store.get(___LAST_TIME_HISTORY_BEING_INDEXED___).onsuccess = async function (ev){
                const lastIndexTimeResult = ev.target.result
                if(!lastIndexTimeResult){
                    store.clear();
                    const set = new Set();
                    const histories = await getHistorySince(HALF_YEAR_AGO);
                    const bookmarks = await getAllBookmarks();
                    histories.forEach(ht => {
                        if(!set.has(ht.url)){
                            set.add(ht.url);
                            saveDbAndBookmarks(ht);
                        }
                    })
                    bookmarks.forEach(bm => {
                        if(!set.has(bm.url)){
                            set.add(bm.url);
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

        const createHistoryAsBookmarkFolder = () => {
           return new Promise(res => {
               const store = getStore('readonly');
               store.get(___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER___).onsuccess = function (ev){
                   const lastIndexTimeResult = ev.target.result;
                   tryCreateHistoryBookmarkFolder(___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER___).then(folderId => {
                       ___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER_ID___ = folderId;
                       if(lastIndexTimeResult !== folderId){
                           updateDb(folderId, ___EXTENSION_HISTORY_AS_BOOKMARKS_FOLDER___) ;
                       }
                       res();
                   });
               }
           })
        }

        const searchDb = keyword => {
           return new Promise(res => {
               const words = keyword.toUpperCase().split(/[ ]+/);
               const objectStore = getStore('readonly');
               const req = objectStore.openCursor();
               const searchResults = [];
               req.onsuccess = function (event){
                   const cursor = event.target.result;
                   if(cursor) {
                       const url = cursor.value && cursor.value.url && cursor.value.url.toUpperCase() ;
                       const title = cursor.value && cursor.value.title && cursor.value.title.toUpperCase();
                       if((url && words.every(w => url.indexOf(w) > -1)) || (title && words.every(w => title.indexOf(w) > -1))){
                           searchResults.push(cursor.value)
                       }
                       cursor.continue();
                   } else {
                       searchResults.sort( (a, b) => {
                           if(a.visitCount === undefined) a.visitCount = 1;
                           if(b.visitCount === undefined) b.visitCount = 1;
                           return b.visitCount - a.visitCount;
                       })
                       return res(searchResults);
                   }
               }
           })
        }

        // create a folder in bookmark manager
        createHistoryAsBookmarkFolder().then(() => {
            // save history and bookmarks immediately when extension is installed.
            saveHistoryAndBookmarks();
        });


        resolve({ saveHistoryAndBookmarks, searchDB: searchDb, closeDb });
    }
})

browser.omnibox.onInputStarted.addListener(ev => {
    dbPromise.then(( {saveHistoryAndBookmarks} ) => saveHistoryAndBookmarks());
})

browser.omnibox.onInputChanged.addListener((text, suggest) => {
    if(!text || text.length < 2){
        return suggest([])
    }

    const map = new Map();

    const cb = (items = []) => {
        items.filter(item => item.url)
            .map(item => {
                const desc = `${encodeXml(item.title)}  -  <url>${encodeXml(item.url)}</url>`
                return {content: item.url, description: desc, deletable: true };
            })
            .filter(item => isValidXml(item.description))
            .forEach(item => map.set(item.content, item));
    }
    return dbPromise.then(({searchDB}) => {
        searchDB(text).then(cb).then(() => {
                const data = Array.from(map.values())
                suggest(data);
        });
    })
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

// browser.omnibox.onDeleteSuggestion.addListener(text => {
//     // delete to database maybe
// })

function getHistorySince(startTime= 0){
    return new Promise(resolve => searchThruHistory('', resolve, startTime, Math.pow(10, 6)));
}

function getAllBookmarks(){
    return new Promise(resolve => {
        const map = new Map();
        const loopNodes = (bookmarkTreeNodeArr = []) => {
            for(let node of bookmarkTreeNodeArr){
                if(!node.children && node.url){
                    map.set(node.url, {id: node.id, url: node.url, tile: node.title, dateAdded: node.dateAdded});
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

function searchThruHistory(keyword, callback,  startTime = 0, maxResults = 100){
    return new Promise(resolve => {
        const map = new Map();
        const cb = results => {
            results
                .filter(item => !(item.url.indexOf("www.google.com") > -1 && item.url.indexOf("/search?q=") > -1))
                .filter(item => !(item.url.indexOf('www.baidu.com/s?') > -1))
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

function addItemInHistoryBookmarkFolder(url, title, folderId){
    if(!folderId){
        console.warn('No parent folder ID specified under which to create bookmark.')
        return Promise.reject();
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