import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 构建目标放低：评委可能在抖音、微信等 App 内置浏览器里打开，内核往往比系统浏览器旧。
// 只转换语法，不补接口；用到的少数新接口在代码里自带退路。
export default defineConfig({
  plugins: [react()],
  build: { target: ['es2019', 'chrome80', 'safari14'] },
});
