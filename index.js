#!/usr/bin/env node

import https from 'https';
import fs from 'fs';
import url from 'url';

import path from 'path';
import puppeteer from 'puppeteer';
import StreamZip from 'node-stream-zip';
import { program } from 'commander';

import os from 'os';
import { getPercentageX } from '@zhea55/crack-tencent-captcha';
import stringSimilarity from 'string-similarity';

const currentDir = path.resolve(process.cwd());
const BASE_URL = 'https://subhd.tv';
const API_SEARCH = `${new URL('search', BASE_URL).href}/`;
const API_GET_DOWNLOAD_URL = '/ajax/down1_ajax';

const BG_IMG_WIDTH = 340;

function getSearchKeyword(videoName) {
  const match = /S\d{1,3}(E\d{1,3})?/gi.exec(videoName);
  let isTVShow = false;
  let keyword = '';

  if (match) {
    isTVShow = true;

    keyword = videoName.substring(0, match.index) + match[0];
  } else {
    const reResolution = /(720p|1080p|2160p)/i;

    const matchedResult = videoName.match(reResolution);

    if (matchedResult) {
      keyword = videoName.substring(0, matchedResult.index);
    }
  }

  console.info(`解析搜索关键词 === ${keyword}`);

  return keyword;
}

async function getDetailUrl(videoName, page) {
  let videoInfoList = await page.$$eval(
    '.view-text.text-secondary a',
    (urls) => {
      return urls.map((url) => {
        return {
          videoName: url.textContent.trim().replace(/[^\x00-\x7F]/g, ''),
          url: url.href
        };
      });
    }
  );

  if (videoInfoList.length) {
    console.info(`共找到${videoInfoList.length}条字幕`);

    const matches = stringSimilarity.findBestMatch(
      videoName,
      videoInfoList.map((o) => o.videoName)
    );

    const downloadTimes = await page.$$eval(
      '.pt-3.text-secondary.f12 .bi-download + span',
      (elements) => {
        return elements.map((el) => parseInt(el.textContent));
      }
    );

    videoInfoList = videoInfoList.map((videoInfo, i) => {
      return { ...videoInfo, downloadTimes: downloadTimes[i] };
    });

    const sameRatingList = videoInfoList.filter((videoInfo) => {
      return videoInfo.videoName === matches.bestMatch.target;
    });

    let bestMatchIndex = -1;
    let maxDownloadTimes = 0;
    sameRatingList.forEach((videoInfo, i) => {
      if (videoInfo.downloadTimes > maxDownloadTimes) {
        maxDownloadTimes = videoInfo.downloadTimes;
        bestMatchIndex = i;
      }
    });

    console.info(`bestMatchIndex === ${bestMatchIndex}`);

    return sameRatingList[bestMatchIndex].url;
  } else {
    throw new Error('未找到任何字幕');
  }
}

function fetchDownloadUrl(page) {
  return page.evaluate(() => {
    window.callback = undefined;
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

async function getBgImage(frame) {
  const bgUrl = await frame.$eval('#slideBg', (el) => {
    return parent
      .getComputedStyle(el)
      .backgroundImage.replace(/^url\(\"/i, '')
      .replace(/\"\)$/, '');
  });

  return await downloadFile(bgUrl, os.tmpdir());
}

function randomInt(min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

async function crackTencentCaptcha(page) {
  const elementHandle = await page.waitForSelector('#tcaptcha_iframe_dy');

  const frame = await elementHandle.contentFrame();

  const bgImgPath = await getBgImage(frame);

  try {
    console.log('尝试破解验证码');
    const percentageX = await getPercentageX(bgImgPath);

    const destX = BG_IMG_WIDTH * percentageX;

    moveSlider(page, frame, destX);
  } catch (error) {
    console.info(`${error.message}，重新刷新验证码`);
    await frame.click('.tc-action-icon.unselectable');

    await crackTencentCaptcha(page);
  }
}

async function moveSlider(page, frame, destX) {
  const sliderElement = await frame.$('.tc-fg-item.tc-slider-normal');

  const sliderX = await frame.evaluate(async (el) => {
    return (
      Math.round(
        parseFloat(
          parent
            .getComputedStyle(el, null)
            .getPropertyValue('left')
            .replace(/px$/i, '')
        )
      ) + 3
    );
  }, sliderElement);

  let slider = await sliderElement.boundingBox();

  let startX = slider.x + slider.width / 2;
  let startY = slider.y + slider.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  const diffX = slider.x - sliderX + destX + 30;
  await page.mouse.move(diffX + randomInt(-5, 5), startY + randomInt(2, 8), {
    steps: randomInt(36, 69)
  });

  await page.mouse.up();
}

function getOfficialAccountCode() {
  const url =
    'https://mp.weixin.qq.com/s?__biz=MzIxNDY4NjIwOQ==&mid=2247536297&idx=1&sn=b8c0525bc5da9c4d4901c53b9a498fb1&chksm=97a1c1c7a0d648d18f936635bb6551466f9d6e919b3c3356c77a11276794330f5a7fd21539ba&xtrack=1&scene=0&subscene=10000&clicktime=1671256253&enterid=1671256253&sessionid=0&ascene=7&fasttmpl_type=0&fasttmpl_fullversion=6459219-en_US-zip&fasttmpl_flag=0&realreporttime=1671256253115#rd';
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
        try {
          const jsonObj = await response.json();
          if (jsonObj.success) {
            resolve(jsonObj.url);
          } else {
            await page.evaluate(() => {
              document.querySelector('.btn.down').scrollIntoView();
            });
            // 需要进行验证码校验
            await page.click(downloadBtnSelector);
          }
        } catch (error) {}
      }

      if (
        response.url().includes('/cap_union_new_verify') &&
        response.status() === 200
      ) {
        const jsonObj = await response.json();
        if (parseInt(jsonObj.errorCode) === 0) {
          console.info('验证码校验成功');
          await fetchDownloadUrl(page);
        } else {
          console.info('验证码校验失败');
          await frame.click('.tc-action-icon.unselectable');

          await crackTencentCaptcha(page);
        }
      }

      if (response.url().includes('/tdc.js') && response.status() === 200) {
        console.info('腾讯验证码加载成功');

        await crackTencentCaptcha(page);
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
            if (err) {
              reject(err);
            } else {
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

function getBrowserOptions() {
  return {
    headless: true,
    slowMo: 100,
    // viewport: { width: 800, height: 600 },
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins',
      '--disable-site-isolation-trials'
    ],
    // devtools: true,
    userDataDir: path.join(
      process.env.HOME || process.env.USERPROFILE,
      '.chromium'
    ),
    defaultViewport: null
  };
}

async function downloadSubAndExtract(downloadUrl) {
  const filePath = await downloadFile(downloadUrl, os.tmpdir());
  console.info('字幕下载成功');

  const fileName = path.basename(url.parse(downloadUrl).pathname);
  const subFilePath = path.join(currentDir, fileName);

  fs.rename(filePath, subFilePath, async (err) => {
    if (err) {
      throw err;
    }

    if (/\.zip$/i.test(fileName)) {
      const zip = new StreamZip.async({ file: subFilePath });
      await zip.extract(null, currentDir);
      await zip.close();

      console.info('字幕压缩包解压成功');

      fs.unlink(subFilePath, (err) => {
        if (err) {
          console.error(err);
        }

        process.exit(0);
      });
    }
  });
}

async function checkDetailPageExists(page) {
  const errMessage = await page.evaluate(() => {
    const el = document.querySelector('body > pre');
    return el ? el.textContent : '';
  });

  if (errMessage) {
    throw new Error(errMessage);
  }
}

async function main() {
  const videoName = path.basename(currentDir);

  const keyword = getSearchKeyword(videoName);

  if (!keyword.length) {
    throw new Error('没有解析到关键词');
  }

  const browser = await puppeteer.launch(getBrowserOptions());

  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().endsWith('.zip')) {
      request.abort();
    } else {
      request.continue();
    }
  });

  await page.goto(new URL(keyword, API_SEARCH).href);

  const detailUrl = await getDetailUrl(videoName, page);

  await page.goto(detailUrl);

  await checkDetailPageExists(page);

  const downloadUrl = await getDownloadUrl(page);

  // await page.waitForTimeout(300000000);

  await page.close();
  await browser.close();

  await downloadSubAndExtract(downloadUrl);
}

main();
