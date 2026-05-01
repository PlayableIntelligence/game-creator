// Ported from kosher.bet/apps/web/src/pages/tables/haggle/mixamoRetarget.ts (plain JS).
// Original credit: pixiv/three-vrm humanoidAnimation examples (MIT).
// Loads a Mixamo FBX clip and retargets it onto a VRM's normalised humanoid so
// every rig plays the same motion regardless of body proportions.

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const mixamoVRMRigMap = {
  mixamorigHips: 'hips',
  mixamorigSpine: 'spine',
  mixamorigSpine1: 'chest',
  mixamorigSpine2: 'upperChest',
  mixamorigNeck: 'neck',
  mixamorigHead: 'head',
  mixamorigLeftShoulder: 'leftShoulder',
  mixamorigLeftArm: 'leftUpperArm',
  mixamorigLeftForeArm: 'leftLowerArm',
  mixamorigLeftHand: 'leftHand',
  mixamorigLeftHandThumb1: 'leftThumbMetacarpal',
  mixamorigLeftHandThumb2: 'leftThumbProximal',
  mixamorigLeftHandThumb3: 'leftThumbDistal',
  mixamorigLeftHandIndex1: 'leftIndexProximal',
  mixamorigLeftHandIndex2: 'leftIndexIntermediate',
  mixamorigLeftHandIndex3: 'leftIndexDistal',
  mixamorigLeftHandMiddle1: 'leftMiddleProximal',
  mixamorigLeftHandMiddle2: 'leftMiddleIntermediate',
  mixamorigLeftHandMiddle3: 'leftMiddleDistal',
  mixamorigLeftHandRing1: 'leftRingProximal',
  mixamorigLeftHandRing2: 'leftRingIntermediate',
  mixamorigLeftHandRing3: 'leftRingDistal',
  mixamorigLeftHandPinky1: 'leftLittleProximal',
  mixamorigLeftHandPinky2: 'leftLittleIntermediate',
  mixamorigLeftHandPinky3: 'leftLittleDistal',
  mixamorigRightShoulder: 'rightShoulder',
  mixamorigRightArm: 'rightUpperArm',
  mixamorigRightForeArm: 'rightLowerArm',
  mixamorigRightHand: 'rightHand',
  mixamorigRightHandPinky1: 'rightLittleProximal',
  mixamorigRightHandPinky2: 'rightLittleIntermediate',
  mixamorigRightHandPinky3: 'rightLittleDistal',
  mixamorigRightHandRing1: 'rightRingProximal',
  mixamorigRightHandRing2: 'rightRingIntermediate',
  mixamorigRightHandRing3: 'rightRingDistal',
  mixamorigRightHandMiddle1: 'rightMiddleProximal',
  mixamorigRightHandMiddle2: 'rightMiddleIntermediate',
  mixamorigRightHandMiddle3: 'rightMiddleDistal',
  mixamorigRightHandIndex1: 'rightIndexProximal',
  mixamorigRightHandIndex2: 'rightIndexIntermediate',
  mixamorigRightHandIndex3: 'rightIndexDistal',
  mixamorigRightHandThumb1: 'rightThumbMetacarpal',
  mixamorigRightHandThumb2: 'rightThumbProximal',
  mixamorigRightHandThumb3: 'rightThumbDistal',
  mixamorigLeftUpLeg: 'leftUpperLeg',
  mixamorigLeftLeg: 'leftLowerLeg',
  mixamorigLeftFoot: 'leftFoot',
  mixamorigLeftToeBase: 'leftToes',
  mixamorigRightUpLeg: 'rightUpperLeg',
  mixamorigRightLeg: 'rightLowerLeg',
  mixamorigRightFoot: 'rightFoot',
  mixamorigRightToeBase: 'rightToes',
};

const fbxCache = new Map();

export function loadMixamoFbx(url) {
  if (fbxCache.has(url)) return fbxCache.get(url);
  const loader = new FBXLoader();
  const p = loader.loadAsync(url);
  fbxCache.set(url, p);
  return p;
}

export function retargetMixamoToVRM(asset, vrm) {
  const clip = THREE.AnimationClip.findByName(asset.animations, 'mixamo.com');
  if (!clip) return null;

  const motionHips = asset.getObjectByName('mixamorigHips');
  if (!motionHips) return null;
  const motionHipsHeight = motionHips.position.y;
  const vrmHipsHeight = vrm.humanoid?.normalizedRestPose.hips?.position?.[1] ?? 0;
  const hipsPositionScale = motionHipsHeight !== 0 ? vrmHipsHeight / motionHipsHeight : 1;
  const isVRM0 = vrm.meta?.metaVersion === '0';

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();
  const tracks = [];

  clip.tracks.forEach((track) => {
    const [mixamoRigName, propertyName] = track.name.split('.');
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
    if (!vrmBoneName) return;
    const vrmNode = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName);
    if (!vrmNode) return;
    const vrmNodeName = vrmNode.name;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);
    if (!mixamoRigNode || !mixamoRigNode.parent) return;

    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = new Float32Array(track.values);
      for (let i = 0; i < values.length; i += 4) {
        _quatA.fromArray(values, i);
        _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        _quatA.toArray(values, i);
      }
      if (isVRM0) {
        for (let i = 0; i < values.length; i += 1) {
          if (i % 2 === 0) values[i] = -values[i];
        }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${vrmNodeName}.${propertyName}`,
        new Float32Array(track.times),
        values,
      ));
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      const values = new Float32Array(track.values);
      for (let i = 0; i < values.length; i += 1) {
        const flip = isVRM0 && i % 3 !== 1 ? -1 : 1;
        values[i] = values[i] * flip * hipsPositionScale;
      }
      tracks.push(new THREE.VectorKeyframeTrack(
        `${vrmNodeName}.${propertyName}`,
        new Float32Array(track.times),
        values,
      ));
    }
  });

  if (tracks.length === 0) return null;
  return new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
}

// Play the animation in reverse by producing a new clip whose tracks have
// their keyframe arrays mirrored. Better than setting `timeScale = -1` on
// the action because LoopOnce + clampWhenFinished + reverse playback has
// flaky 'finished' timing in three.js — with a true reversed clip everything
// is forward-playback and chain scheduling Just Works.
export function reverseClip(clip) {
  const duration = clip.duration;
  const tracks = clip.tracks.map((track) => {
    const n = track.times.length;
    const stride = track.getValueSize();
    const times = new Float32Array(n);
    for (let i = 0; i < n; i++) times[i] = duration - track.times[n - 1 - i];
    const values = new Float32Array(n * stride);
    for (let i = 0; i < n; i++) {
      const src = (n - 1 - i) * stride;
      const dst = i * stride;
      for (let j = 0; j < stride; j++) values[dst + j] = track.values[src + j];
    }
    return new track.constructor(track.name, times, values);
  });
  return new THREE.AnimationClip(`${clip.name}_reversed`, duration, tracks);
}

// Trim the final `seconds` off a clip. Mixamo exports frequently append a
// rest-pose snap at the end, and the retarget math ((premultiply parent rest)
// composed with (multiply inverse local rest)) can amplify that snap into a
// visibly disjointed arm when clampWhenFinished holds the final frame.
// Cropping the last 0.05-0.15 s usually eliminates it.
export function trimClipEnd(clip, seconds) {
  const newDuration = Math.max(0.01, clip.duration - seconds);
  const tracks = clip.tracks.map((track) => {
    const n = track.times.length;
    const stride = track.getValueSize();
    let cut = n;
    for (let i = 0; i < n; i++) {
      if (track.times[i] > newDuration) { cut = i; break; }
    }
    // Keep at least 2 keyframes so interpolation stays sane.
    if (cut < 2) cut = Math.min(2, n);
    const times = new Float32Array(cut);
    const values = new Float32Array(cut * stride);
    for (let i = 0; i < cut; i++) {
      times[i] = track.times[i];
      for (let j = 0; j < stride; j++) values[i * stride + j] = track.values[i * stride + j];
    }
    return new track.constructor(track.name, times, values);
  });
  return new THREE.AnimationClip(`${clip.name}_trimmed`, newDuration, tracks);
}
