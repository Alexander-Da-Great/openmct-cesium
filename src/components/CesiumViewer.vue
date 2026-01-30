<template>
  <div ref="cesiumContainer" class="cesium-viewer-container"></div>
</template>

<script>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import CesiumService from '../services/CesiumService.js';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export default {
  name: 'CesiumViewer',
  props: {
    domainObject: {
      type: Object,
      required: false,
      default: null
    },
    options: {
      type: Object,
      required: false,
      default: () => ({})
    }
  },
  setup(props) {
    const cesiumContainer = ref(null);

    onMounted(() => {
      if (cesiumContainer.value) {
        try {
          // Initialize the Cesium viewer using the service
          CesiumService.initializeViewer(cesiumContainer.value, props.options);
          console.log('CesiumViewer: Viewer mounted and initialized');
        } catch (error) {
          console.error('CesiumViewer: Failed to initialize viewer', error);
        }
      }
    });

    onBeforeUnmount(() => {
      // Clean up the viewer when component is unmounted
      CesiumService.destroy();
      console.log('CesiumViewer: Component unmounted, viewer destroyed');
    });

    return {
      cesiumContainer
    };
  }
};
</script>

<style scoped>
.cesium-viewer-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

/* Ensure Cesium viewer fills the entire container */
.cesium-viewer-container :deep(.cesium-viewer) {
  width: 100%;
  height: 100%;
}
</style>
