import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/**
 * Mixamo → VRM retargeter. Loads a Mixamo FBX animation and rewrites every
 * track to play on a VRM's normalized humanoid skeleton.
 *
 * WHY this is needed: VRMs ship without animations, by design — they use a
 * standard skeleton so any animation can play on any VRM. Mixamo (Adobe's
 * free-with-account animation library) has thousands of FBX clips, but they
 * use Mixamo bone names (`mixamorigHips`, `mixamorigSpine`, ...) and slightly
 * different rest poses. This retargeter rewrites the track names AND adjusts
 * for rest-pose differences so a single FBX motion plays cleanly on any VRM.
 *
 * Source: ported from splats-repo mixamo-retarget.ts, which is itself ported
 * from the pixiv/three-vrm humanoidAnimation example.
 *
 * Get FBX clips:
 *   1. Sign in at https://www.mixamo.com (free)
 *   2. Pick an animation, click "Without Skin"
 *   3. Download as FBX
 *   4. Drop into public/assets/animations/
 */

// Mixamo bone names → VRM humanoid bone names.
// Subset that animation tracks usually touch (hips, spine, chest, neck, head,
// arms, legs, hands, fingers). Expand as needed for finger-detailed clips.
const MIXAMO_TO_VRM = {
  mixamorigHips:                'hips',
  mixamorigSpine:               'spine',
  mixamorigSpine1:              'chest',
  mixamorigSpine2:              'upperChest',
  mixamorigNeck:                'neck',
  mixamorigHead:                'head',
  mixamorigLeftShoulder:        'leftShoulder',
  mixamorigLeftArm:             'leftUpperArm',
  mixamorigLeftForeArm:         'leftLowerArm',
  mixamorigLeftHand:            'leftHand',
  mixamorigLeftHandThumb1:      'leftThumbMetacarpal',
  mixamorigLeftHandThumb2:      'leftThumbProximal',
  mixamorigLeftHandThumb3:      'leftThumbDistal',
  mixamorigLeftHandIndex1:      'leftIndexProximal',
  mixamorigLeftHandIndex2:      'leftIndexIntermediate',
  mixamorigLeftHandIndex3:      'leftIndexDistal',
  mixamorigLeftHandMiddle1:     'leftMiddleProximal',
  mixamorigLeftHandMiddle2:     'leftMiddleIntermediate',
  mixamorigLeftHandMiddle3:     'leftMiddleDistal',
  mixamorigLeftHandRing1:       'leftRingProximal',
  mixamorigLeftHandRing2:       'leftRingIntermediate',
  mixamorigLeftHandRing3:       'leftRingDistal',
  mixamorigLeftHandPinky1:      'leftLittleProximal',
  mixamorigLeftHandPinky2:      'leftLittleIntermediate',
  mixamorigLeftHandPinky3:      'leftLittleDistal',
  mixamorigRightShoulder:       'rightShoulder',
  mixamorigRightArm:            'rightUpperArm',
  mixamorigRightForeArm:        'rightLowerArm',
  mixamorigRightHand:           'rightHand',
  mixamorigRightHandPinky1:     'rightLittleProximal',
  mixamorigRightHandPinky2:     'rightLittleIntermediate',
  mixamorigRightHandPinky3:     'rightLittleDistal',
  mixamorigRightHandRing1:      'rightRingProximal',
  mixamorigRightHandRing2:      'rightRingIntermediate',
  mixamorigRightHandRing3:      'rightRingDistal',
  mixamorigRightHandMiddle1:    'rightMiddleProximal',
  mixamorigRightHandMiddle2:    'rightMiddleIntermediate',
  mixamorigRightHandMiddle3:    'rightMiddleDistal',
  mixamorigRightHandIndex1:     'rightIndexProximal',
  mixamorigRightHandIndex2:     'rightIndexIntermediate',
  mixamorigRightHandIndex3:     'rightIndexDistal',
  mixamorigRightHandThumb1:     'rightThumbMetacarpal',
  mixamorigRightHandThumb2:     'rightThumbProximal',
  mixamorigRightHandThumb3:     'rightThumbDistal',
  mixamorigLeftUpLeg:           'leftUpperLeg',
  mixamorigLeftLeg:             'leftLowerLeg',
  mixamorigLeftFoot:            'leftFoot',
  mixamorigLeftToeBase:         'leftToes',
  mixamorigRightUpLeg:          'rightUpperLeg',
  mixamorigRightLeg:            'rightLowerLeg',
  mixamorigRightFoot:           'rightFoot',
  mixamorigRightToeBase:        'rightToes',
};

const _fbxCache = new Map();   // url → Promise<THREE.Group>

export function loadMixamoFbx(url) {
  if (_fbxCache.has(url)) return _fbxCache.get(url);
  const p = new FBXLoader().loadAsync(url);
  _fbxCache.set(url, p);
  return p;
}

/**
 * Retarget a Mixamo FBX onto a VRM's humanoid skeleton. Returns an
 * AnimationClip ready to play on `vrm.scene` via AnimationMixer. Returns
 * null if the FBX isn't a Mixamo asset (no `mixamorigHips`).
 */
export function retargetMixamoToVRM(asset, vrm) {
  const animations = asset.animations;
  // Mixamo names its main clip 'mixamo.com' by convention
  const clip = animations
    ? THREE.AnimationClip.findByName(animations, 'mixamo.com') || animations[0]
    : null;
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

  for (const track of clip.tracks) {
    const [mixamoRigName, propertyName] = track.name.split('.');
    const vrmBoneName = MIXAMO_TO_VRM[mixamoRigName];
    if (!vrmBoneName) continue;
    const vrmNode = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName);
    if (!vrmNode) continue;

    const vrmNodeName = vrmNode.name;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);
    if (!mixamoRigNode || !mixamoRigNode.parent) continue;

    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = new Float32Array(track.values);
      for (let i = 0; i < values.length; i += 4) {
        _quatA.fromArray(values, i);
        _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        _quatA.toArray(values, i);
      }
      // VRM 0.x has flipped X/Z axes vs VRM 1.0
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
        const flip = (isVRM0 && i % 3 !== 1) ? -1 : 1;
        values[i] = values[i] * flip * hipsPositionScale;
      }
      tracks.push(new THREE.VectorKeyframeTrack(
        `${vrmNodeName}.${propertyName}`,
        new Float32Array(track.times),
        values,
      ));
    }
  }

  if (tracks.length === 0) return null;
  return new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
}
