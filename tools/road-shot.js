import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
const p = await b.newPage()
p.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 160)))
p.on('console', (m) => console.log('C[' + m.type() + ']:', m.text().slice(0, 160)))
await p.goto('http://localhost:5173/2d.html', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise((r) => setTimeout(r, 7000))
const alive = await p.evaluate(() => ({ game: !!window.game, t: Math.round(performance.now()) })).catch((e) => 'EVALFAIL ' + e.message.slice(0, 120))
console.log('STATE:', JSON.stringify(alive))
await b.close()