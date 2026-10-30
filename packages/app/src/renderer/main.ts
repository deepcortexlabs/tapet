import { mount } from 'svelte'
import App from './App.svelte'
import { client } from './client.svelte.ts'
import './base.css'

// The preload script forwards the MessagePort to the session process.
window.addEventListener('message', (event) => {
  const [port] = event.ports
  if (event.source !== window || event.data !== 'tapet-port' || !port) {
    return
  }

  client.connect(port)
})

window.addEventListener('error', (event) => client.error(event.message))
window.addEventListener('unhandledrejection', (event) => client.error(String(event.reason)))

const target = document.getElementById('tapet')
if (target) {
  mount(App, { target })
}
