<template>
    <div ref="cesiumContainer" class="cesium-viewer-wrapper"></div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, inject } from 'vue';

const props = defineProps(['domainObject']);
const openmct = inject('openmct');
const cesiumService = inject('cesiumService');
const cesiumContainer = ref(null);
const unsubscribes = new Map();
let resizeObserver;

onMounted(() => {
    // 1. Initialize
    cesiumService.init(cesiumContainer.value, openmct);

    // 2. Force an immediate resize to fix the "top-left corner" bug
    if (cesiumService.viewer) {
        cesiumService.viewer.resize();
    }

    // 3. Watch for Open MCT pane resizes (Cosmographia feel)
    resizeObserver = new ResizeObserver(() => {
        if (cesiumService.viewer) {
            cesiumService.viewer.resize();
        }
    });
    resizeObserver.observe(cesiumContainer.value);

    const composition = openmct.composition.get(props.domainObject);
    
    const onAdd = (child) => {
        const id = openmct.objects.makeKeyString(child.identifier);
        cesiumService.addSatellite(child, openmct);
        const unsub = openmct.telemetry.subscribe(child, (datum) => {
            cesiumService.updateSatellite(id, datum);
        });
        unsubscribes.set(id, unsub);
    };

    const onRemove = (identifier) => {
        const id = openmct.objects.makeKeyString(identifier);
        cesiumService.removeSatellite(id);
        if (unsubscribes.has(id)) {
            unsubscribes.get(id)();
            unsubscribes.delete(id);
        }
    };

    composition.on('add', onAdd);
    composition.on('remove', onRemove);
    composition.load();
});

onBeforeUnmount(() => {
    if (resizeObserver) resizeObserver.disconnect();
    unsubscribes.forEach(unsub => unsub());
    cesiumService.destroy();
});
</script>

<style scoped>
.cesium-viewer-wrapper {
    width: 100%;
    height: 100%;
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #000;
}

/* Ensure Cesium widget itself fills the wrapper */
:deep(.cesium-viewer), :deep(.cesium-widget) {
    width: 100% !important;
    height: 100% !important;
}
</style>