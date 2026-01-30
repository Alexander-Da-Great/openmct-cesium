import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/cesium/Build/Cesium/Assets/*',
          dest: 'Assets'
        },
        {
          src: 'node_modules/cesium/Build/Cesium/Widgets/*',
          dest: 'Widgets'
        },
        {
          src: 'node_modules/cesium/Build/Cesium/Workers/*',
          dest: 'Workers'
        },
        {
          src: 'node_modules/cesium/Build/Cesium/ThirdParty/*',
          dest: 'ThirdParty'
        }
      ]
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('')
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'OpenMCTCesium',
      fileName: (format) => `openmct-cesium.${format}.js`,
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: ['vue', 'openmct'],
      output: {
        globals: {
          vue: 'Vue',
          openmct: 'openmct'
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
