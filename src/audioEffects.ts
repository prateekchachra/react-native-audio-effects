import AudioEffects from './AudioEffectsModule';



export async function playSound(isLoop: boolean, fileName: string, decibels: number) {
    return AudioEffects.playSound(isLoop, fileName, decibels);
  }

export async function stopSound() {
    return AudioEffects.stopSound();
  }

export async function playBrownNoise(decibels: number) {
    return AudioEffects.playBrownNoise(decibels);
  }
export async function stopBrownNoise() {
    return AudioEffects.stopBrownNoise();
  }

export async function playPinkNoise(decibels: number) {
    return AudioEffects.playPinkNoise(decibels);
  }
export async function stopPinkNoise() {
    return AudioEffects.stopPinkNoise();
  }

export async function playWhiteNoise(decibels: number) {
    return AudioEffects.playWhiteNoise(decibels);
  }
export async function stopWhiteNoise() {
    return AudioEffects.stopWhiteNoise();
  }
