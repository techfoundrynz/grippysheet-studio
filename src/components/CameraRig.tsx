import React, { useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type ViewState = {
  type: 'iso' | 'ortho';
  timestamp: number;
};

interface CameraRigProps {
  viewState: ViewState;
  size: number;
  setCameraType: (type: 'perspective' | 'orthographic') => void;
}

const CameraRig: React.FC<CameraRigProps> = ({ viewState, size, setCameraType }) => {
  const { camera, controls, size: canvasSize } = useThree();
  const targetPos = React.useRef(new THREE.Vector3(500, -500, 500));
  const targetZoom = React.useRef(1);
  const targetLookAt = React.useRef(new THREE.Vector3(0, 0, 0));
  const animationPhase = React.useRef<'idle' | 'rotate' | 'zoom'>('idle');
  const lastTimestamp = React.useRef(0);
  const animationStart = React.useRef(0);
  const pendingOrthoZoom = React.useRef<number | null>(null);

  useEffect(() => {
    // Only trigger if timestamp changed (user action)
    if (viewState.timestamp === lastTimestamp.current) return;
    lastTimestamp.current = viewState.timestamp;

    // 1. Setup based on View Type
    if (viewState.type === 'ortho') {
      // Transition to Ortho:
      // Keep Perspective (don't switch yet)
      targetPos.current.set(0, -1, 1000); // Top view position
      
      // Calculate target zoom for Fit (to apply later)
      const minDim = Math.min(canvasSize.width, canvasSize.height);
      const fitZoom = (minDim * 0.7) / size;
      targetZoom.current = fitZoom;
      
    } else {
      // Transition to Iso:
      // Switch to Perspective immediately
      setCameraType('perspective');
      targetPos.current.set(500, -500, 500); 
      targetZoom.current = 1; // Perspective zoom usually 1
    }
    
    // 2. Reset Controls Target
    targetLookAt.current.set(0, 0, 0);
    
    // 3. Start Animation
    animationPhase.current = 'rotate';
    animationStart.current = Date.now();
    pendingOrthoZoom.current = null; // Reset

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewState]);

  // Handle Camera Switch (Apply matched zoom)
  useEffect(() => {
     if (camera instanceof THREE.OrthographicCamera && pendingOrthoZoom.current !== null) {
         camera.zoom = pendingOrthoZoom.current;
         camera.updateProjectionMatrix();
         // Reset pending
         pendingOrthoZoom.current = null;
     }
  }, [camera]);

  // Stop animation when user interacts
  useEffect(() => {
    if (!controls) return;
    const ctrl = controls as any;
    const callback = () => {
        // Grace period: ignore events shortly after animation starts
        if (Date.now() - animationStart.current < 200) return;
        animationPhase.current = 'idle';
    };
    ctrl.addEventListener('start', callback);
    return () => ctrl.removeEventListener('start', callback);
  }, [controls]);

  useFrame((_, delta) => {
      if (animationPhase.current === 'idle') return;

      const damp = Math.min(15 * delta, 0.8); 
      const epsilon = 0.001;
      const zoomEpsilon = 0.001;

      // PHASE 1: ROTATE & PAN
      if (animationPhase.current === 'rotate') {
          // Lerp Position with Slerp-like behavior (Nlerp)
          const distCurrent = camera.position.distanceTo(JSON.stringify(targetLookAt.current) === JSON.stringify(new THREE.Vector3(0,0,0)) ? new THREE.Vector3(0,0,0) : targetLookAt.current);
          const distTarget = targetPos.current.distanceTo(new THREE.Vector3(0,0,0));
          
          camera.position.lerp(targetPos.current, damp);
          const interpolatedDist = THREE.MathUtils.lerp(distCurrent, distTarget, damp);
          camera.position.normalize().multiplyScalar(interpolatedDist);
          
          // Lerp Controls Target
          if (controls) {
             const orbit = controls as any;
             orbit.target.lerp(targetLookAt.current, damp);
             orbit.update();
          }

          // Check if Rotation Finished
          const distPos = camera.position.distanceTo(targetPos.current);
          if (distPos < 5) { 
               // If going to Ortho, switch NOW
               if (viewState.type === 'ortho' && !(camera instanceof THREE.OrthographicCamera)) {
                   
                   // Calculate Matched Zoom for smooth transition
                   const dist = camera.position.distanceTo(targetLookAt.current); // Should be ~1000
                   // Perspective visible height at distance d = 2 * d * tan(fov/2)
                   // We assume default FOV 45
                   const fovRad = (45 * Math.PI) / 180;
                   const visibleHeight = 2 * dist * Math.tan(fovRad / 2); // ~828 at 1000
                   const matchedZoom = canvasSize.height / visibleHeight;
                   
                   pendingOrthoZoom.current = matchedZoom;
                   setCameraType('orthographic');
               }
               animationPhase.current = 'zoom';
          }
      }

      // PHASE 2: ZOOM (Sequential)
      if (animationPhase.current === 'zoom') {
          // Continue positional lerp
          camera.position.lerp(targetPos.current, damp);
          if (controls) {
             const orbit = controls as any;
             orbit.target.lerp(targetLookAt.current, damp);
             orbit.update();
          }

          // Lerp Zoom
          let currentZoom = camera.zoom;
          
          if (camera instanceof THREE.OrthographicCamera) {
              camera.zoom = THREE.MathUtils.lerp(camera.zoom, targetZoom.current, damp);
              camera.updateProjectionMatrix();
              currentZoom = camera.zoom;
          } else {
              // Perspective Zoom (FOV scaling? or just 1?)
              // Generally keep at 1. If we used zoom for effect, we'd lerp it.
              camera.zoom = THREE.MathUtils.lerp(camera.zoom, 1, damp);
              camera.updateProjectionMatrix();
              currentZoom = camera.zoom;
          }

          // Check Completion
          const distPos = camera.position.distanceTo(targetPos.current);
          const distZoom = Math.abs(currentZoom - targetZoom.current);

          if (distPos < epsilon && distZoom < zoomEpsilon) {
              animationPhase.current = 'idle';
          }
      }
  });

  return null;
};

export default CameraRig;
