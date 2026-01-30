<template>
  <div ref="cesiumContainer" class="cesium-viewer-container"></div>
</template>

<script>
import { onMounted, onBeforeUnmount, ref, inject } from 'vue';
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
    const openmct = inject('openmct');
    let telemetryUnsubscribe = null;

    onMounted(() => {
      if (cesiumContainer.value) {
        try {
          // Initialize the Cesium viewer using the service
          CesiumService.initializeViewer(cesiumContainer.value, props.options);
          console.log('CesiumViewer: Viewer mounted and initialized');

          // If we have a satellite domain object, visualize it
          if (props.domainObject && props.domainObject.type === 'satellite') {
            const satelliteId = props.domainObject.identifier.key;

            if (!openmct) {
              console.warn('CesiumViewer: OpenMCT instance not available, cannot subscribe to telemetry');
              return;
            }

            console.log(`CesiumViewer: Setting up telemetry subscription for ${satelliteId}`);

            // Subscribe to telemetry updates
            telemetryUnsubscribe = openmct.telemetry.subscribe(
              props.domainObject,
              (telemetryPoint) => {
                // Extract position from telemetry
                const position = {
                  lat: telemetryPoint['position.latitude'],
                  lon: telemetryPoint['position.longitude'],
                  alt: telemetryPoint['position.altitude']
                };

                // Update satellite position on globe
                CesiumService.setSatellitePosition(satelliteId, position);
              }
            );

            console.log(`CesiumViewer: Telemetry subscription active for ${satelliteId}`);
          }
        } catch (error) {
          console.error('CesiumViewer: Failed to initialize viewer', error);
        }
      }
    });

    onBeforeUnmount(() => {
      // Unsubscribe from telemetry
      if (telemetryUnsubscribe) {
        telemetryUnsubscribe();
        telemetryUnsubscribe = null;
        console.log('CesiumViewer: Telemetry unsubscribed');
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
