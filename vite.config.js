import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        // --- CESIUM STATIC ASSETS ---
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
        },
        // --- OPEN MCT STATIC ASSETS ---
        // This ensures fonts and themes load correctly from the root path
        {
          src: 'node_modules/openmct/dist/fonts/*',
          dest: 'fonts'
        },
        {
          src: 'node_modules/openmct/dist/*.css',
          dest: './' // Puts snowTheme.css, etc., in the root
        }
      ]
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Important: Tells Vite where to find the Open MCT source
      'openmct': resolve(__dirname, './node_modules/openmct/dist/openmct.js')
    }
  },
  define: {
    // This tells the Cesium library to look in the root directory for its assets
    CESIUM_BASE_URL: JSON.stringify('')
  },
  server: {
    port: 3000,
    open: true,
    fs: {
      // Allows Vite to serve files from parent folders if necessary
      allow: ['..']
    }
  },
  build: {
    // Ensures the worker files are bundled correctly
    rollupOptions: {
      output: {
        manualChunks: {
          cesium: ['cesium']
        }
      }
    }
  }
});