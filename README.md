# History-As-Bookmark

This [history-as-bookmark](https://github.com/gaoqing/history-as-bookmark) is a browser extension, make all your browsing history - URLs available for your searching in the address bar.

Note that browser only keep the latest several months of history, and also some records cannot be well picked up while typing in address bar and have to go into dedicated history page to search.

The extension, however will automatically save your browsing history into [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) and build up the history store going forward, with no limited time period in a persistent way, additionally it will back them up under browser's bookmark manager too.

Make it very easy for your searching in address bar and visit them again, under the assumption that a URL you visited once, you will probably visit one more time or more in the future.

So with this, you don't need to manually bookmark those URLs, history now become your bookmarks!



![til](./demo.gif)

### Browser supports
It supports both Chrome and Firefox.

### Usage
##### It is yet to be deployed in Chrome web store, stay tuned.
now locally you can clone this codebase, then install and try:

* In Chrome: Open the chrome://extensions page, click load unpacked, and then select the folder in which the manifest.json file exists.
* In Firefox: Open the about:debugging page, click "This Firefox" (in newer versions of Firefox), click "Load Temporary Add-on", then select any file in the extension's directory.

To use, in browser address bar:  
 * In chrome: type letter 'h' followed by [Tab keystroke] or [Space keystroke]
 * In firefox: type letter 'h' followed by [Space keystroke]

And then can start typing your keywords, browser will forward your input to this extension to handle, which is to search your browser history in indexedDB records.
Those matched URLs will be showed in dropdown list, depends on browser setting, only couples of matching will be showed, key in more keywords separated by space to give more details. most frequent visited URLs will be listed from top down. 

Also, since your history have been included into bookmark manager, you can directly type keyword in address bar without using h+Tab/Space way, that will fall into browser default bookmarks searching and ordering logic. 


<br/>
