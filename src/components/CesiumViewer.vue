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
    let telemetryInterval = null;
    let currentPosition = {
      lat: 0,
      lon: 0,
      alt: 400000 // 400km altitude (typical LEO satellite)
    };

    onMounted(() => {
      if (cesiumContainer.value) {
        try {
          // Initialize the Cesium viewer using the service
          CesiumService.initializeViewer(cesiumContainer.value, props.options);
          console.log('CesiumViewer: Viewer mounted and initialized');

          // If we have a satellite domain object, visualize it
          if (props.domainObject && props.domainObject.type === 'satellite') {
            const satelliteId = props.domainObject.identifier.key;

            // Set initial position
            CesiumService.setSatellitePosition(satelliteId, currentPosition);
            console.log(`CesiumViewer: Initialized satellite ${satelliteId}`);

            // Mock telemetry: Update position every second
            // Increment longitude to simulate orbital motion
            telemetryInterval = setInterval(() => {
              currentPosition.lon += 1.5; // Move 1.5 degrees east per second

              // Wrap longitude at 180/-180
              if (currentPosition.lon > 180) {
                currentPosition.lon -= 360;
              }

              // Update satellite position
              CesiumService.setSatellitePosition(satelliteId, currentPosition);
            }, 1000); // Update every 1 second

            console.log('CesiumViewer: Mock telemetry started');
          }
        } catch (error) {
          console.error('CesiumViewer: Failed to initialize viewer', error);
        }
      }
    });

    onBeforeUnmount(() => {
      // Stop telemetry updates
      if (telemetryInterval) {
        clearInterval(telemetryInterval);
        telemetryInterval = null;
        console.log('CesiumViewer: Mock telemetry stopped');
      }

      // Remove satellite entity if it exists
      if (props.domainObject && props.domainObject.type === 'satellite') {
        const satelliteId = props.domainObject.identifier.key;
        CesiumService.removeSatellite(satelliteId);
        console.log(`CesiumViewer: Removed satellite ${satelliteId}`);
      }

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
