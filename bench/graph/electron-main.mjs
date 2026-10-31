// Opens the benchmark page in a window in front of the others: hidden or covered windows
// throttle their frames, which would skew the frame rates.
import { app, BrowserWindow } from 'electron'

void app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { backgroundThrottling: false },
  })
  app.focus({ steal: true })
  return window.loadURL(process.env.BENCH_URL ?? 'about:blank')
})
