import CesiumViewerComponent from '../components/CesiumViewer.vue';
import { createApp } from 'vue';

/**
 * CesiumPlugin for Open MCT
 * Provides 3D visualization capabilities using Cesium
 */
export default function CesiumPlugin() {
  return function install(openmct) {
    // Register the Cesium object view provider
    openmct.objectViews.addProvider({
      key: 'cesium-viewer',
      name: 'Earth View',
      cssClass: 'icon-globe',

      /**
       * Determine if this view can display the given domain object
       * For now, returns true for all objects to immediately see the globe
       *
       * @param {Object} domainObject - The Open MCT domain object
       * @returns {boolean} True if this view can display the object
       */
      canView(domainObject) {
        // TODO: Later, restrict this to specific types like 'satellite'
        // return domainObject.type === 'satellite';

        // For now, show the globe for all objects
        return true;
      },

      /**
       * Create and return the view
       *
       * @param {Object} domainObject - The Open MCT domain object
       * @param {Array} objectPath - The path to this object in the navigation tree
       * @returns {Object} View object with show, destroy, and getViewContext methods
       */
      view(domainObject, objectPath) {
        let vueApp = null;
        let container = null;

        return {
          /**
           * Render the view into the provided container
           * @param {HTMLElement} element - The container element
           */
          show(element) {
            container = element;

            // Create Vue app instance with the CesiumViewer component
            vueApp = createApp(CesiumViewerComponent, {
              domainObject,
              options: {
                // Pass any Cesium-specific options here
              }
            });

            // Mount the Vue app to the container
            vueApp.mount(container);
          },

          /**
           * Clean up and destroy the view
           */
          destroy() {
            if (vueApp) {
              vueApp.unmount();
              vueApp = null;
            }
            container = null;
          },

          /**
           * Get the view context for Open MCT
           * @returns {Object} Context object
           */
          getViewContext() {
            return {
              type: 'cesium-viewer'
            };
          }
        };
      },

      /**
       * Priority for this view provider (higher = more preferred)
       * Set to 100 to make it default for objects it can view
       */
      priority() {
        return 100;
      }
    });

    console.log('CesiumPlugin: Installed successfully');
  };
}
