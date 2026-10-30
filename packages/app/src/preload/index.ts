// Hands the window its MessagePort to the session process.
import { ipcRenderer } from 'electron'

ipcRenderer.on('tapet-port', (event) => {
  window.postMessage('tapet-port', '*', event.ports)
})
