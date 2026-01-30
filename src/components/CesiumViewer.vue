<template>
  <div ref="cesiumContainer" class="cesium-viewer-container"></div>
</template>

<script>
import { onMounted, onBeforeUnmount, ref, inject } from 'vue';
import * as Cesium from 'cesium';
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
    let timeListener = null;
    let clockListener = null;
    let tickListener = null;

    onMounted(async () => {
      if (cesiumContainer.value) {
        try {
          // Initialize the Cesium viewer using the service
          CesiumService.initializeViewer(cesiumContainer.value, props.options);
          console.log('CesiumViewer: Viewer mounted and initialized');

          // If we have a satellite domain object, visualize it
          if (props.domainObject && props.domainObject.type === 'satellite') {
            if (!openmct) {
              console.warn('CesiumViewer: OpenMCT instance not available');
              return;
            }

            const satelliteId = props.domainObject.identifier.key;
            console.log(`CesiumViewer: Setting up visualization for ${satelliteId}`);

            // Load historical telemetry data
            await loadHistoricalData(satelliteId);

            // Set up Time Conductor integration
            setupTimeIntegration(satelliteId);

            // Subscribe to real-time telemetry updates (for live mode)
            telemetryUnsubscribe = openmct.telemetry.subscribe(
              props.domainObject,
              (telemetryPoint) => {
                // Only update if in real-time mode
                if (openmct.time.getClock()) {
                  const position = {
                    lat: telemetryPoint['position.latitude'],
                    lon: telemetryPoint['position.longitude'],
                    alt: telemetryPoint['position.altitude']
                  };
                  CesiumService.setSatellitePosition(satelliteId, position);
                }
              }
            );

            console.log(`CesiumViewer: Setup complete for ${satelliteId}`);
          }
        } catch (error) {
          console.error('CesiumViewer: Failed to initialize viewer', error);
        }
      }
    });

    /**
     * Load historical telemetry data and set up trajectory
     */
    async function loadHistoricalData(satelliteId) {
      try {
        const bounds = openmct.time.getBounds();
        console.log(`CesiumViewer: Loading historical data for bounds:`, {
          start: new Date(bounds.start).toISOString(),
          end: new Date(bounds.end).toISOString(),
          startMs: bounds.start,
          endMs: bounds.end
        });

        const historicalData = await openmct.telemetry.request(
          props.domainObject,
          {
            start: bounds.start,
            end: bounds.end,
            strategy: 'latest'
          }
        );

        if (historicalData && historicalData.length > 0) {
          console.log(`CesiumViewer: Loaded ${historicalData.length} historical points for ${satelliteId}`);
          console.log(`CesiumViewer: Data range:`, {
            first: new Date(historicalData[0].timestamp).toISOString(),
            last: new Date(historicalData[historicalData.length - 1].timestamp).toISOString(),
            firstMs: historicalData[0].timestamp,
            lastMs: historicalData[historicalData.length - 1].timestamp
          });
          CesiumService.setSatelliteTrajectory(satelliteId, historicalData);
        } else {
          console.warn(`CesiumViewer: No historical data returned for ${satelliteId}`);
        }
      } catch (error) {
        console.error('CesiumViewer: Failed to load historical data', error);
      }
    }

    /**
     * Set up Time Conductor integration for playback control
     */
    function setupTimeIntegration(satelliteId) {
      const viewer = CesiumService.getViewer();
      if (!viewer) {
        return;
      }

      // Sync Cesium clock with OpenMCT time conductor
      const timeConductor = openmct.time;

      // Listen for time bounds changes
      timeListener = timeConductor.on('bounds', async (bounds) => {
        console.log(`CesiumViewer: Time bounds changed, reloading data`);
        await loadHistoricalData(satelliteId);

        // Update Cesium clock bounds
        viewer.clock.startTime = Cesium.JulianDate.fromDate(new Date(bounds.start));
        viewer.clock.stopTime = Cesium.JulianDate.fromDate(new Date(bounds.end));

        // Set current time to match OpenMCT's current time, not start time
        const currentTime = timeConductor.getClock() ? Date.now() : bounds.start;
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(currentTime));
      });

      // Listen for clock changes (real-time vs fixed-time)
      clockListener = timeConductor.on('clock', (clock) => {
        console.log(`CesiumViewer: Clock mode changed`, clock);
        if (clock) {
          // Real-time mode - sync to current time
          viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());
          viewer.clock.shouldAnimate = true;
        } else {
          // Fixed-time mode (historical playback) - stop animation
          viewer.clock.shouldAnimate = false;
        }
      });

      // Listen to OpenMCT time tick events and sync Cesium clock
      tickListener = timeConductor.on('tick', (timestamp) => {
        // Only update Cesium clock when in fixed-time mode (not real-time)
        if (!timeConductor.getClock()) {
          const newCesiumTime = Cesium.JulianDate.fromDate(new Date(timestamp));
          viewer.clock.currentTime = newCesiumTime;

          // Debug logging to track synchronization
          const cesiumTimeAsDate = Cesium.JulianDate.toDate(viewer.clock.currentTime);
          console.log(`CesiumViewer Time Sync - OpenMCT: ${new Date(timestamp).toISOString()} (${timestamp}), Cesium: ${cesiumTimeAsDate.toISOString()} (${cesiumTimeAsDate.getTime()})`);
        }
      });

      // Set initial clock state
      const bounds = timeConductor.getBounds();
      const clock = timeConductor.getClock();

      viewer.clock.startTime = Cesium.JulianDate.fromDate(new Date(bounds.start));
      viewer.clock.stopTime = Cesium.JulianDate.fromDate(new Date(bounds.end));

      // Set current time based on mode
      if (clock) {
        // Real-time mode
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());
        viewer.clock.shouldAnimate = true;
      } else {
        // Fixed-time mode
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(bounds.start));
        viewer.clock.shouldAnimate = false;
      }

      viewer.clock.multiplier = 1;

      // Debug: Log initial clock state
      const currentCesiumTime = Cesium.JulianDate.toDate(viewer.clock.currentTime);
      console.log(`CesiumViewer: Time Conductor integration complete`, {
        mode: clock ? 'real-time' : 'fixed',
        bounds: {
          start: new Date(bounds.start).toISOString(),
          end: new Date(bounds.end).toISOString()
        },
        cesiumClock: {
          current: currentCesiumTime.toISOString(),
          currentMs: currentCesiumTime.getTime(),
          start: Cesium.JulianDate.toDate(viewer.clock.startTime).toISOString(),
          stop: Cesium.JulianDate.toDate(viewer.clock.stopTime).toISOString(),
          shouldAnimate: viewer.clock.shouldAnimate
        }
      });
    }

    onBeforeUnmount(() => {
      // Unsubscribe from telemetry
      if (telemetryUnsubscribe) {
        telemetryUnsubscribe();
        telemetryUnsubscribe = null;
        console.log('CesiumViewer: Telemetry unsubscribed');
      }

      // Remove time listeners
      if (openmct && timeListener) {
        openmct.time.off('bounds', timeListener);
        timeListener = null;
        console.log('CesiumViewer: Time bounds listener removed');
      }

      if (openmct && clockListener) {
        openmct.time.off('clock', clockListener);
        clockListener = null;
        console.log('CesiumViewer: Clock listener removed');
      }

      if (openmct && tickListener) {
        openmct.time.off('tick', tickListener);
        tickListener = null;
        console.log('CesiumViewer: Tick listener removed');
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
