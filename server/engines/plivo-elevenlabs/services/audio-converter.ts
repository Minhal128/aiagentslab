'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs Audio Converter
 * 
 * Handles audio format conversion between:
 * - Plivo: G.711 μ-law (PCMU) 8kHz
 * - ElevenLabs: PCM16 16kHz
 * 
 * Uses proper μ-law decoding/encoding with resampling.
 * ============================================================
 */

/**
 * μ-law decoding table (ITU-T G.711)
 * Maps μ-law byte (0-255) to 16-bit PCM sample
 */
const MULAW_DECODE_TABLE: Int16Array = new Int16Array([
  -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
  -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
  -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
  -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
  -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
  -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
  -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
  -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
  -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
  -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
  -876, -844, -812, -780, -748, -716, -684, -652,
  -620, -588, -556, -524, -492, -460, -428, -396,
  -372, -356, -340, -324, -308, -292, -276, -260,
  -244, -228, -212, -196, -180, -164, -148, -132,
  -120, -112, -104, -96, -88, -80, -72, -64,
  -56, -48, -40, -32, -24, -16, -8, 0,
  32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
  23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
  15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
  11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
  7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
  5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
  3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
  2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
  1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
  1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
  876, 844, 812, 780, 748, 716, 684, 652,
  620, 588, 556, 524, 492, 460, 428, 396,
  372, 356, 340, 324, 308, 292, 276, 260,
  244, 228, 212, 196, 180, 164, 148, 132,
  120, 112, 104, 96, 88, 80, 72, 64,
  56, 48, 40, 32, 24, 16, 8, 0
]);

export class AudioConverter {
  private static readonly PLIVO_SAMPLE_RATE = 8000;
  private static readonly ELEVENLABS_SAMPLE_RATE = 16000;
  private static readonly MULAW_BIAS = 0x84;
  private static readonly MULAW_MAX = 32635;
  
  /**
   * Convert μ-law 8kHz (Plivo) to PCM16 16kHz (ElevenLabs)
   * 
   * Steps:
   * 1. Decode μ-law bytes to PCM16 samples using lookup table
   * 2. Upsample 8kHz → 16kHz using linear interpolation
   */
  static mulawToPcm16(mulawBuffer: Buffer): Buffer {
    const inputLength = mulawBuffer.length;
    const outputLength = inputLength * 4;
    const output = Buffer.alloc(outputLength);
    
    let outIndex = 0;
    let prevSample = MULAW_DECODE_TABLE[mulawBuffer[0]];
    
    for (let i = 0; i < inputLength; i++) {
      const currentSample = MULAW_DECODE_TABLE[mulawBuffer[i]];
      
      output.writeInt16LE(prevSample, outIndex);
      outIndex += 2;
      
      const interpolated = Math.round((prevSample + currentSample) / 2);
      output.writeInt16LE(interpolated, outIndex);
      outIndex += 2;
      
      prevSample = currentSample;
    }
    
    return output;
  }
  
  /**
   * Convert PCM16 16kHz (ElevenLabs) to μ-law 8kHz (Plivo)
   * 
   * Steps:
   * 1. Downsample 16kHz → 8kHz by averaging pairs
   * 2. Encode each PCM16 sample to μ-law byte
   */
  static pcm16ToMulaw(pcmBuffer: Buffer): Buffer {
    const inputSamples = pcmBuffer.length / 2;
    const outputLength = Math.floor(inputSamples / 2);
    const output = Buffer.alloc(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const pcmIndex1 = i * 4;
      const pcmIndex2 = pcmIndex1 + 2;
      
      let sample1 = 0;
      let sample2 = 0;
      
      if (pcmIndex1 + 1 < pcmBuffer.length) {
        sample1 = pcmBuffer.readInt16LE(pcmIndex1);
      }
      if (pcmIndex2 + 1 < pcmBuffer.length) {
        sample2 = pcmBuffer.readInt16LE(pcmIndex2);
      }
      
      const avgSample = Math.round((sample1 + sample2) / 2);
      output[i] = this.linearToMulaw(avgSample);
    }
    
    return output;
  }
  
  /**
   * Encode a single PCM16 sample to μ-law byte (ITU-T G.711)
   */
  private static linearToMulaw(sample: number): number {
    let sign = 0;
    
    if (sample < 0) {
      sign = 0x80;
      sample = -sample;
    }
    
    if (sample > this.MULAW_MAX) {
      sample = this.MULAW_MAX;
    }
    
    sample += this.MULAW_BIAS;
    
    let exponent = 7;
    let mask = 0x4000;
    
    while (exponent > 0 && (sample & mask) === 0) {
      exponent--;
      mask >>= 1;
    }
    
    const mantissa = (sample >> (exponent + 3)) & 0x0F;
    const mulawByte = ~(sign | (exponent << 4) | mantissa);
    
    return mulawByte & 0xFF;
  }
  
  /**
   * Encode buffer to base64
   */
  static encodeBase64(buffer: Buffer): string {
    return buffer.toString('base64');
  }
  
  /**
   * Decode base64 to buffer
   */
  static decodeBase64(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
  }
}
