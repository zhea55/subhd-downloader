<div align="center">
# [subhd](https://subhd.tv/)字幕下载器
</div>

---
鉴于目前其他字幕下载工具都不能使用了，所以只能自己动手。
由于该网站有腾讯的验证码，故本项目使用了[opencv](https://opencv.org/)来分析验证码的背景图片。

---


[![asciicast](https://asciinema.org/a/OVpalSsonEw1DgDMsmzgXN0pO.svg)](https://asciinema.org/a/OVpalSsonEw1DgDMsmzgXN0pO)



## 安装依赖

### Windows
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools

winget install "Visual Studio Community 2022"  --override "--add Microsoft.VisualStudio.Workload.NativeDesktop  Microsoft.VisualStudio.ComponentGroup.WindowsAppSDK.Cpp"  -s msstore


scoop install cmake make python
```



## 使用方法
```bash
git clone https://github.com/zhea55/crack-tencent-captcha.git
cd crack-tencent-captcha
npm i

npx build-opencv --nobuild rebuild


cd ../


git clone https://github.com/zhea55/subhd-downloader.git
cd subhd-downloader
npm i
npm link
```
在视频所在的目录中运行<code>subhd-dl</code>



## 已知问题
目前下载器只会抓取搜索结果第一页的数据。
