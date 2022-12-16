import { inspect } from 'util';
import https from 'https';
import fs from 'fs';
import url from 'url';

import path from 'path';
import puppeteer from 'puppeteer';
import StreamZip from 'node-stream-zip';
import { program } from 'commander';
import dom2image from 'dom-to-image';
import { resolve } from 'dns';

const currentDir = path.resolve(process.cwd());

const BASE_URL = 'https://subhd.tv';
const API_SEARCH = new URL('search', BASE_URL).href + '/';
const API_GET_DOWNLOAD_URL = '/ajax/down1_ajax';

// const opencvString = fs.readFileSync('./dist/opencv')

// 图片的缩放比例
const SCALE_RATIO = 672 / 340;

function getSearchKeyword(videoName) {
  console.info('解析搜索关键词');
  const match = /S\d{1,3}(E\d{1,3})?/gi.exec(videoName);
  let isTVShow = false;
  let keyword = '';

  if (match) {
    isTVShow = true;

    keyword = videoName.substring(0, match.index) + match[0];
  }

  return keyword;
}

async function getDetailUrl(videoName, page) {
  const videoUrlList = await page.$$eval(
    '.view-text.text-secondary a',
    (urls) => {
      return urls.map((url) => {
        return {
          videoName: url.textContent.trim(),
          url: url.href
        };
      });
    }
  );

  const downloadTimes = await page.$$eval(
    '.pt-3.text-secondary.f12 .bi-download + span',
    (downloadTimes) => {
      return downloadTimes.map((el) => parseInt(el.textContent));
    }
  );

  const results = [];

  let maxDownloadTimes = 0;
  let maxDownloadTimesIndex = -1;
  const regexVideoName = new RegExp(videoName, 'i');
  videoUrlList.forEach((obj, i) => {
    if (regexVideoName.test(obj.videoName)) {
      const value = downloadTimes[i];
      results.push({ ...obj, downloadTimes: value });

      if (value > maxDownloadTimes) {
        maxDownloadTimes = value;
        maxDownloadTimesIndex = i;
      }
    }
  });

  if (results.length) {
    return videoUrlList[maxDownloadTimesIndex].url;
  }

  console.table(results);

  return '';
}

function fetchDownloadUrl(page) {
  return page.evaluate(() => {
    $.ajax({
      type: 'POST',
      url: '/ajax/down1_ajax',
      cache: false,
      dataType: 'json',
      data: {
        sub_id: $('.down').attr('sid'),
        ccode: $('.down').attr('ccode')
      }
    });
  });
}

async function prepareImages(frame) {
  await frame.$eval('#slideBg', (el) => {
    const bgUrl = parent
      .getComputedStyle(el)
      .backgroundImage.replace(/^url\(\"/i, '')
      .replace(/\"\)$/, '');

    const img = document.createElement('img');

    img.src = bgUrl;
    img.id = 'bgImg';

    img.onload = () => {
      img.style.width = img.naturalWidth;
      img.style.height = img.naturalHeight;
    };

    parent.document.body.appendChild(img);
  });

  const sliderX = await frame.$$eval(
    '.tc-fg-item:not(.tc-slider-normal)',
    async (elements) => {
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];

        const canvas = await parent.html2canvas(el, {
          allowTaint: true,
          logging: true,
          taintTest: false
        });
        if (canvas.width / canvas.height === 1) {
          const img = document.createElement('img');
          img.style.width = '120px';
          img.style.height = '120px';
          img.src = canvas.toDataURL();
          img.id = 'sliderImg';

          parent.document.body.appendChild(img);

          return parseInt(
            parent
              .getComputedStyle(el, null)
              .getPropertyValue('left')
              .replace(/px$/i, '')
          );
        }
      }
    }
  );

  return sliderX;
}

function randomInt(min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

async function getDiffX(page) {
  const elementHandle = await page.waitForSelector('#tcaptcha_iframe_dy');

  const frame = await elementHandle.contentFrame();

  const sliderX = await prepareImages(frame);

  const diffX = await frame.evaluate(async (sliderX) => {
    const bgImg = parent.document.getElementById('bgImg');
    const sliderImg = parent.document.getElementById('sliderImg');

    const rect = parent.findMostSimilarRect(parent.cv, bgImg, sliderImg);

    if (rect) {
      return rect.x;
    }

    return 0;
  }, sliderX);

  const sliderElement = (await frame.$x('//*[@id="tcOperation"]/div[6]'))[0];
  let slider = await sliderElement.boundingBox();

  let startX = slider.x + slider.width / 2;
  let startY = slider.y + slider.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  await page.mouse.move(slider.x - sliderX + diffX / SCALE_RATIO, startY, {
    steps: randomInt(36, 69)
  });

  await page.waitForTimeout(300000000);
}

async function injectScripts(page) {
  await page.addScriptTag({
    path: path.join(process.cwd() + '/dist/opencv.js')
  });

  await page.addScriptTag({
    path: path.join(process.cwd() + '/dist/bundle.js'),
    type: 'module'
  });

  await page.addScriptTag({
    path: path.join(process.cwd() + '/dist/html2canvas.js')
  });
}

async function getDownloadUrl(page) {
  const downloadBtnSelector = '.btn.down';

  await fetchDownloadUrl(page);

  return new Promise((resolve, reject) => {
    page.on('response', async (response) => {
      if (
        response.url().includes(API_GET_DOWNLOAD_URL) &&
        response.status() === 200
      ) {
        const jsonObj = await response.json();
        if (jsonObj.success) {
          resolve(jsonObj.url);
        } else {
          // 需要进行验证码校验
          await page.click(downloadBtnSelector);

          await injectScripts(page);

          await getDiffX(page);
        }
      }

      if (
        response.url().includes('/ajax/cap_ajax') &&
        response.status() === 200
      ) {
        await fetchDownloadUrl(page);
      }

      if (
        response.url().includes('/cap_union_new_verify') &&
        response.status() === 200
      ) {
        console.error('验证码校验失败');
      }
    });
  });
}

function downloadFile(downloadUrl, dest) {
  const fileName = path.basename(url.parse(downloadUrl).pathname);
  const file = fs.createWriteStream(path.join(dest, fileName));

  return new Promise((resolve, reject) => {
    https
      .get(downloadUrl, (response) => {
        response.pipe(file);
        file.on('finish', async () => {
          file.close((err) => {
            if (!err) {
              resolve(file.path);
            }
          });
        });
      })
      .on('error', (err) => {
        fs.unlink(file.path);
        reject(err);
      });
  });
}

async function main() {
  const testName = 'Tulsa.King.S01E05.2160p.WEB.H265-GLHF[rarbg]'.replace(
    /\[\w+\]$/,
    ''
  );
  const keyword = getSearchKeyword(testName);

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
    // viewport: { width: 800, height: 600 },
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins',
      '--disable-site-isolation-trials'
    ],
    devtools: true,
    userDataDir: path.join(
      process.env.HOME || process.env.USERPROFILE,
      '.chromium'
    ),
    defaultViewport: null
  });

  const page = await browser.newPage();

  await page.goto(new URL(keyword, API_SEARCH).href);

  const detailUrl = await getDetailUrl(testName, page);

  console.log('detailUrl === ' + detailUrl);

  await page.goto(detailUrl);

  const downloadUrl = await getDownloadUrl(page);
  console.log('downloadUrl ==== ' + downloadUrl);
  // browser.close()

  const DOWNLOAD_DIR = path.join(
    process.env.HOME || process.env.USERPROFILE,
    'Downloads/'
  );

  const filePath = await downloadFile(downloadUrl, DOWNLOAD_DIR);
  console.log(currentDir);

  const fileName = path.basename(url.parse(downloadUrl).pathname);
  const subFilePath = path.join(currentDir, fileName);
  fs.rename(filePath, subFilePath, async (err) => {
    if (err) throw err;

    const zip = new StreamZip.async({ file: subFilePath });
    await zip.extract(null, './');
    await zip.close();

    fs.unlink(subFilePath, (err) => {
      if (err) {
        console.error(err);
      }
    });
  });
}

main();
