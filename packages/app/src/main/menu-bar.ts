// Menu-bar mode: no Dock icon on macOS, and a tray icon whose menu lists tapet's open windows.
import { join } from 'node:path'
import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron'

export interface MenuBar {
  // Rebuilds the menu after windows open, close or change their titles.
  refresh(): void
}

export function createMenuBar(windows: () => BrowserWindow[]): MenuBar {
  app.dock?.hide()
  // The "Template" suffix lets macOS tint the icon for light and dark menu bars.
  const tray = new Tray(
    nativeImage.createFromPath(join(import.meta.dirname, '../../resources/trayTemplate.png')),
  )
  tray.setToolTip('tapet')

  function refresh() {
    const open = windows().filter((window) => !window.isDestroyed())
    const items: Electron.MenuItemConstructorOptions[] =
      open.length > 0
        ? open.map((window) => ({
            label: window.getTitle(),
            click: () => {
              window.show()
              window.focus()
            },
          }))
        : [{ label: 'No windows open', enabled: false }]
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...items,
        { type: 'separator' },
        { label: 'Quit tapet', click: () => app.quit() },
      ]),
    )
  }

  refresh()
  return { refresh }
}
