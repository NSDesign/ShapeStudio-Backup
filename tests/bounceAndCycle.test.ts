import { describe, it, expect } from 'vitest';
import { applyThresholdModulation } from '../shared/incrementalUtils';
import {
  calculateSquiggleAmplitude,
  calculateSquiggleFrequency,
  calculateSquigglePhase,
  calculateSquiggleAlign,
  calculateSquiggleJitter,
  calculateSquiggleJitterSeed,
  calculateSquiggleNoise,
  calculateSquiggleNoiseFreq,
} from '../shared/shapePropertyUtils';
import { defaultBatchConfigSettings } from '../shared/schema';

// ---------------------------------------------------------------------------
// applyThresholdModulation — cycle (sawtooth) vs bounce (triangle-wave)
// ---------------------------------------------------------------------------

describe('applyThresholdModulation – cycle mode (bounce=false)', () => {
  // start=0, inc=1, threshold=4  → steps = floor(4/1)+1 = 5  (indices 0..4)
  // sawtooth: 0,1,2,3,4, 0,1,2,3,4, …
  const start = 0, inc = 1, threshold = 4;

  it('returns startValue at index 0', () => {
    expect(applyThresholdModulation(0, start, inc, threshold)).toBe(0);
  });

  it('forward ramp through first cycle', () => {
    expect(applyThresholdModulation(1, start, inc, threshold)).toBe(1);
    expect(applyThresholdModulation(2, start, inc, threshold)).toBe(2);
    expect(applyThresholdModulation(3, start, inc, threshold)).toBe(3);
    expect(applyThresholdModulation(4, start, inc, threshold)).toBe(4);
  });

  it('resets to startValue at index 5 (start of second cycle)', () => {
    expect(applyThresholdModulation(5, start, inc, threshold)).toBe(0);
  });

  it('continues forward ramp in second cycle', () => {
    expect(applyThresholdModulation(6, start, inc, threshold)).toBe(1);
    expect(applyThresholdModulation(7, start, inc, threshold)).toBe(2);
  });
});

describe('applyThresholdModulation – bounce mode (bounce=true)', () => {
  // start=0, inc=1, threshold=4  → steps=5, period=2*(5-1)=8
  // triangle: 0,1,2,3,4,3,2,1, 0,1,2,3,4,3,2,1, …
  const start = 0, inc = 1, threshold = 4;

  it('returns startValue at index 0', () => {
    expect(applyThresholdModulation(0, start, inc, threshold, 0, false, 0, false, true)).toBe(0);
  });

  it('forward ramp up to threshold', () => {
    expect(applyThresholdModulation(1, start, inc, threshold, 0, false, 0, false, true)).toBe(1);
    expect(applyThresholdModulation(2, start, inc, threshold, 0, false, 0, false, true)).toBe(2);
    expect(applyThresholdModulation(3, start, inc, threshold, 0, false, 0, false, true)).toBe(3);
    expect(applyThresholdModulation(4, start, inc, threshold, 0, false, 0, false, true)).toBe(4);
  });

  it('reverses direction after hitting threshold', () => {
    expect(applyThresholdModulation(5, start, inc, threshold, 0, false, 0, false, true)).toBe(3);
    expect(applyThresholdModulation(6, start, inc, threshold, 0, false, 0, false, true)).toBe(2);
    expect(applyThresholdModulation(7, start, inc, threshold, 0, false, 0, false, true)).toBe(1);
  });

  it('second forward ramp starts at index 8 (period boundary)', () => {
    expect(applyThresholdModulation(8, start, inc, threshold, 0, false, 0, false, true)).toBe(0);
    expect(applyThresholdModulation(9, start, inc, threshold, 0, false, 0, false, true)).toBe(1);
  });
});

describe('applyThresholdModulation – bounce vs cycle diverge at midpoint', () => {
  // With start=0, inc=1, threshold=4:
  //   steps=5, period=8
  //   At index 5: cycle → 0 (reset), bounce → 3 (descending)
  //   At index 6: cycle → 1,          bounce → 2
  const start = 0, inc = 1, threshold = 4;

  it('cycle and bounce produce the same value at the start (index 0)', () => {
    const cycle  = applyThresholdModulation(0, start, inc, threshold, 0, false, 0, false, false);
    const bounce = applyThresholdModulation(0, start, inc, threshold, 0, false, 0, false, true);
    expect(cycle).toBe(bounce);
  });

  it('cycle and bounce diverge at the midpoint (index 5)', () => {
    const cycle  = applyThresholdModulation(5, start, inc, threshold, 0, false, 0, false, false);
    const bounce = applyThresholdModulation(5, start, inc, threshold, 0, false, 0, false, true);
    expect(cycle).not.toBe(bounce);
    expect(cycle).toBe(0);   // sawtooth resets
    expect(bounce).toBe(3);  // triangle descends
  });

  it('cycle and bounce diverge at index 6', () => {
    const cycle  = applyThresholdModulation(6, start, inc, threshold, 0, false, 0, false, false);
    const bounce = applyThresholdModulation(6, start, inc, threshold, 0, false, 0, false, true);
    expect(cycle).not.toBe(bounce);
    expect(cycle).toBe(1);
    expect(bounce).toBe(2);
  });

  it('cycle output never descends (always advances monotonically within a period)', () => {
    for (let i = 0; i < 20; i++) {
      const v = applyThresholdModulation(i, start, inc, threshold, 0, false, 0, false, false);
      expect(v).toBeGreaterThanOrEqual(start);
      expect(v).toBeLessThanOrEqual(threshold);
    }
  });

  it('bounce output forms a symmetric triangle (never below start, never above threshold)', () => {
    for (let i = 0; i < 20; i++) {
      const v = applyThresholdModulation(i, start, inc, threshold, 0, false, 0, false, true);
      expect(v).toBeGreaterThanOrEqual(start);
      expect(v).toBeLessThanOrEqual(threshold);
    }
  });
});

describe('applyThresholdModulation – bounce with negative increment', () => {
  // start=10, inc=-2, threshold=2  → range=8, steps=5, period=8
  // bounce: 10,8,6,4,2,4,6,8, 10,8,…
  const start = 10, inc = -2, threshold = 2;

  it('descends toward threshold', () => {
    expect(applyThresholdModulation(0, start, inc, threshold, 0, false, 0, false, true)).toBe(10);
    expect(applyThresholdModulation(1, start, inc, threshold, 0, false, 0, false, true)).toBe(8);
    expect(applyThresholdModulation(2, start, inc, threshold, 0, false, 0, false, true)).toBe(6);
    expect(applyThresholdModulation(4, start, inc, threshold, 0, false, 0, false, true)).toBe(2);
  });

  it('ascends back after reversal', () => {
    expect(applyThresholdModulation(5, start, inc, threshold, 0, false, 0, false, true)).toBe(4);
    expect(applyThresholdModulation(6, start, inc, threshold, 0, false, 0, false, true)).toBe(6);
    expect(applyThresholdModulation(7, start, inc, threshold, 0, false, 0, false, true)).toBe(8);
  });

  it('cycle resets to start at index 5 instead of ascending', () => {
    const cycle  = applyThresholdModulation(5, start, inc, threshold, 0, false, 0, false, false);
    const bounce = applyThresholdModulation(5, start, inc, threshold, 0, false, 0, false, true);
    expect(cycle).toBe(10);  // sawtooth resets to start
    expect(bounce).toBe(4);  // triangle ascends
    expect(cycle).not.toBe(bounce);
  });
});

// ---------------------------------------------------------------------------
// _calcSquiggle bounce vs cycle — tested via all 8 public squiggle calculators
//
// The bounce formula (in _calcSquiggle incremental mode):
//   period   = 2 * modulationValue
//   rawPos   = (|inc| * idx) % period
//   triPos   = rawPos <= modValue ? rawPos : period - rawPos
//   result   = startValue + sign(inc) * triPos
//
// The cycle formula:
//   result = startValue + (inc * idx) % modulationValue
//
// Both diverge clearly once rawPos exceeds modulationValue.
// ---------------------------------------------------------------------------

// Shared typed base — avoids `as any`; individual tests spread and override only what they need.
const base = { ...defaultBatchConfigSettings };

describe('_calcSquiggle bounce path – calculateSquiggleAmplitude', () => {
  // defaults: startValue=2, inc=1, modValue=10, driver='shapeIndex'
  // bounce at idx=11: period=20, rawPos=11>10, triPos=9, result=2+9=11
  // cycle  at idx=11: (1*11)%10=1, result=2+1=3
  const cycleS  = { ...base, strokeSquiggleAmplitudeMode: 'incremental' as const, strokeSquiggleAmplitudeModulationEnabled: true, strokeSquiggleBounce: false };
  const bounceS = { ...base, strokeSquiggleAmplitudeMode: 'incremental' as const, strokeSquiggleAmplitudeModulationEnabled: true, strokeSquiggleBounce: true };

  it('agree at index 0', () => {
    expect(calculateSquiggleAmplitude(cycleS, 0)).toBe(calculateSquiggleAmplitude(bounceS, 0));
  });

  it('diverge past modulation midpoint (idx=11)', () => {
    expect(calculateSquiggleAmplitude(cycleS, 11)).toBe(3);
    expect(calculateSquiggleAmplitude(bounceS, 11)).toBe(11);
    expect(calculateSquiggleAmplitude(cycleS, 11)).not.toBe(calculateSquiggleAmplitude(bounceS, 11));
  });

  it('bounce produces symmetric output around the peak', () => {
    // ascending idx=9 and descending idx=11 should be equidistant from start
    expect(calculateSquiggleAmplitude(bounceS, 9)).toBe(calculateSquiggleAmplitude(bounceS, 11));
  });

  it('bounce reverses: value at idx=11 is less than at peak idx=10', () => {
    expect(calculateSquiggleAmplitude(bounceS, 11)).toBeLessThan(calculateSquiggleAmplitude(bounceS, 10));
  });
});

describe('_calcSquiggle bounce path – calculateSquiggleFrequency', () => {
  // defaults: startValue=1, inc=0.5, modValue=10, driver='shapeIndex'
  // bounce at idx=21: rawPos=(0.5*21)%20=10.5>10, triPos=9.5, result=1+9.5=10.5
  // cycle  at idx=21: (0.5*21)%10=0.5, result=1+0.5=1.5
  const cycleS  = { ...base, strokeSquiggleFrequencyMode: 'incremental' as const, strokeSquiggleFrequencyModulationEnabled: true, strokeSquiggleBounce: false };
  const bounceS = { ...base, strokeSquiggleFrequencyMode: 'incremental' as const, strokeSquiggleFrequencyModulationEnabled: true, strokeSquiggleBounce: true };

  it('agree at index 0', () => {
    expect(calculateSquiggleFrequency(cycleS, 0)).toBe(calculateSquiggleFrequency(bounceS, 0));
  });

  it('diverge past modulation midpoint (idx=21)', () => {
    expect(calculateSquiggleFrequency(cycleS, 21)).toBeCloseTo(1.5, 9);
    expect(calculateSquiggleFrequency(bounceS, 21)).toBeCloseTo(10.5, 9);
    expect(calculateSquiggleFrequency(cycleS, 21)).not.toBe(calculateSquiggleFrequency(bounceS, 21));
  });

  it('bounce reverses: value decreases after peak at idx=20', () => {
    expect(calculateSquiggleFrequency(bounceS, 21)).toBeLessThan(calculateSquiggleFrequency(bounceS, 20));
  });
});

describe('_calcSquiggle bounce path – calculateSquigglePhase', () => {
  // defaults: startValue=0, inc=0.5, modValue=6.28, driver='shapeIndex', no clamp
  // bounce at idx=14: period=12.56, rawPos=7>6.28, triPos=12.56-7=5.56, result=0+5.56=5.56
  // cycle  at idx=14: (0.5*14)%6.28=7%6.28=0.72, result=0.72
  const cycleS  = { ...base, strokeSquigglePhaseMode: 'incremental' as const, strokeSquigglePhaseModulationEnabled: true, strokeSquiggleBounce: false };
  const bounceS = { ...base, strokeSquigglePhaseMode: 'incremental' as const, strokeSquigglePhaseModulationEnabled: true, strokeSquiggleBounce: true };

  it('agree at index 0', () => {
    expect(calculateSquigglePhase(cycleS, 0)).toBe(calculateSquigglePhase(bounceS, 0));
  });

  it('diverge past modulation midpoint (idx=14)', () => {
    const cycleVal  = calculateSquigglePhase(cycleS, 14);
    const bounceVal = calculateSquigglePhase(bounceS, 14);
    expect(cycleVal).toBeCloseTo(0.72, 5);
    expect(bounceVal).toBeCloseTo(5.56, 5);
    expect(cycleVal).not.toBeCloseTo(bounceVal, 3);
  });

  it('bounce reverses: value decreases after peak at the modulation boundary', () => {
    // idx=13 is still ascending, idx=14 is descending past the boundary
    expect(calculateSquigglePhase(bounceS, 14)).toBeLessThan(calculateSquigglePhase(bounceS, 13));
  });
});

describe('_calcSquiggle bounce path – calculateSquiggleAlign', () => {
  // defaults: startValue=100, inc=-5, modValue=100, driver='shapeIndex'
  // bounce at idx=21: absInc=5, period=200, rawPos=(5*21)%200=105>100,
  //   triPos=200-105=95, result=100+(-1)*95=5 → clamped to [0,100]=5
  // cycle  at idx=21: ((-5)*21)%100=(-105)%100=-5, result=100+(-5)=95 → clamped=95
  const cycleS  = { ...base, strokeSquiggleAlignMode: 'incremental' as const, strokeSquiggleAlignModulationEnabled: true, strokeSquiggleBounce: false };
  const bounceS = { ...base, strokeSquiggleAlignMode: 'incremental' as const, strokeSquiggleAlignModulationEnabled: true, strokeSquiggleBounce: true };

  it('agree at index 0', () => {
    expect(calculateSquiggleAlign(cycleS, 0)).toBe(calculateSquiggleAlign(bounceS, 0));
  });

  it('diverge past modulation midpoint (idx=21)', () => {
    expect(calculateSquiggleAlign(cycleS, 21)).toBeCloseTo(95, 9);
    expect(calculateSquiggleAlign(bounceS, 21)).toBeCloseTo(5, 9);
    expect(calculateSquiggleAlign(cycleS, 21)).not.toBe(calculateSquiggleAlign(bounceS, 21));
  });

  it('bounce reverses: value increases back toward start after the modulation boundary', () => {
    // With negative increment, "reverse" means going back up toward startValue=100
    expect(calculateSquiggleAlign(bounceS, 21)).toBeGreaterThan(calculateSquiggleAlign(bounceS, 20));
  });
});

describe('_calcSquiggle bounce path – calculateSquiggleJitter', () => {
  // defaults: startValue=0, inc=1, modValue=20, driver='shapeIndex'
  // bounce at idx=21: period=40, rawPos=21>20, triPos=40-21=19, result=0+19=19
  // cycle  at idx=21: (1*21)%20=1, result=0+1=1
  const cycleS  = { ...base, strokeSquiggleJitterMode: 'incremental' as const, strokeSquiggleJitterModulationEnabled: true, strokeSquiggleBounce: false };
  const bounceS = { ...base, strokeSquiggleJitterMode: 'incremental' as const, strokeSquiggleJitterModulationEnabled: true, strokeSquiggleBounce: true };

  it('agree at index 0', () => {
    expect(calculateSquiggleJitter(cycleS, 0)).toBe(calculateSquiggleJitter(bounceS, 0));
  });

  it('diverge past modulation midpoint (idx=21)', () => {
    expect(calculateSquiggleJitter(cycleS, 21)).toBe(1);
    expect(calculateSquiggleJitter(bounceS, 21)).toBe(19);
    expect(calculateSquiggleJitter(cycleS, 21)).not.toBe(calculateSquiggleJitter(bounceS, 21));
  });

  it('bounce reverses: value at idx=21 is less than peak at idx=20', () => {
    expect(calculateSquiggleJitter(bounceS, 21)).toBeLessThan(calculateSquiggleJitter(bounceS, 20));
  });
});

describe('_calcSquiggle bounce path – calculateSquiggleJitterSeed', () => {
  // defaults: startValue=0, inc=1, modValue=9999, driver='shapeIndex'
  // bounce at idx=10000: period=19998, rawPos=10000>9999, triPos=19998-10000=9998, result=9998
  // cycle  at idx=10000: (1*10000)%9999=1, result=1
  const cycleS  = { ...base, strokeSquiggleJitterSeedMode: 'incremental' as const, strokeSquiggleJitterSeedModulationEnabled: true, strokeSquiggleBounce: false };
  const bounceS = { ...base, strokeSquiggleJitterSeedMode: 'incremental' as const, strokeSquiggleJitterSeedModulationEnabled: true, strokeSquiggleBounce: true };

  it('agree at index 0', () => {
    expect(calculateSquiggleJitterSeed(cycleS, 0)).toBe(calculateSquiggleJitterSeed(bounceS, 0));
  });

  it('diverge past modulation midpoint (idx=10000)', () => {
    expect(calculateSquiggleJitterSeed(cycleS, 10000)).toBe(1);
    expect(calculateSquiggleJitterSeed(bounceS, 10000)).toBe(9998);
    expect(calculateSquiggleJitterSeed(cycleS, 10000)).not.toBe(calculateSquiggleJitterSeed(bounceS, 10000));
  });

  it('bounce reverses: value at idx=10000 is less than peak at idx=9999', () => {
    expect(calculateSquiggleJitterSeed(bounceS, 10000)).toBeLessThan(calculateSquiggleJitterSeed(bounceS, 9999));
  });
});

describe('_calcSquiggle bounce path – calculateSquiggleNoise', () => {
  // defaults: startValue=0, inc=1, modValue=20, driver='shapeIndex'
  // bounce at idx=21: period=40, rawPos=21>20, triPos=19, result=19
  // cycle  at idx=21: (1*21)%20=1, result=1
  const cycleS  = { ...base, strokeSquiggleNoiseMode: 'incremental' as const, strokeSquiggleNoiseModulationEnabled: true, strokeSquiggleBounce: false };
  const bounceS = { ...base, strokeSquiggleNoiseMode: 'incremental' as const, strokeSquiggleNoiseModulationEnabled: true, strokeSquiggleBounce: true };

  it('agree at index 0', () => {
    expect(calculateSquiggleNoise(cycleS, 0)).toBe(calculateSquiggleNoise(bounceS, 0));
  });

  it('diverge past modulation midpoint (idx=21)', () => {
    expect(calculateSquiggleNoise(cycleS, 21)).toBe(1);
    expect(calculateSquiggleNoise(bounceS, 21)).toBe(19);
    expect(calculateSquiggleNoise(cycleS, 21)).not.toBe(calculateSquiggleNoise(bounceS, 21));
  });

  it('bounce reverses: value at idx=21 is less than peak at idx=20', () => {
    expect(calculateSquiggleNoise(bounceS, 21)).toBeLessThan(calculateSquiggleNoise(bounceS, 20));
  });
});

// ---------------------------------------------------------------------------
// applyThresholdModulation — bounce + startOffset / wrapOffset
// ---------------------------------------------------------------------------

describe('applyThresholdModulation – bounce + startOffset (linear)', () => {
  // start=0, inc=1, threshold=4, startOffset=1 (linear), bounce=true
  //
  // Leg 0 (wrapCount=0, forward)  effectiveStart=0, effectiveThreshold=4, steps=5
  //   idx 0..4  → 0,1,2,3,4
  // Leg 1 (wrapCount=1, backward) effectiveStart=1, effectiveThreshold=4, steps=4
  //   idx 5..8  → 4,3,2,1         (effectiveThreshold – inc×localIndex)
  // Leg 2 (wrapCount=2, forward)  effectiveStart=2, effectiveThreshold=4, steps=3
  //   idx 9..11 → 2,3,4
  // Leg 3 (wrapCount=3, backward) effectiveStart=3, effectiveThreshold=4, steps=2
  //   idx 12..13 → 4,3

  const S = 0, I = 1, T = 4, SO = 1;

  it('leg 0: first leg matches simple bounce (startOffset has no effect at wrapCount=0)', () => {
    expect(applyThresholdModulation(0, S, I, T, SO, false, 0, false, true)).toBe(0);
    expect(applyThresholdModulation(2, S, I, T, SO, false, 0, false, true)).toBe(2);
    expect(applyThresholdModulation(4, S, I, T, SO, false, 0, false, true)).toBe(4);
  });

  it('leg 1 backward: starts at effectiveThreshold (4), effectiveStart shifted to 1, shorter leg', () => {
    expect(applyThresholdModulation(5, S, I, T, SO, false, 0, false, true)).toBe(4);
    expect(applyThresholdModulation(6, S, I, T, SO, false, 0, false, true)).toBe(3);
    expect(applyThresholdModulation(7, S, I, T, SO, false, 0, false, true)).toBe(2);
    expect(applyThresholdModulation(8, S, I, T, SO, false, 0, false, true)).toBe(1);
  });

  it('leg 2 forward: effectiveStart shifted to 2, even shorter leg', () => {
    expect(applyThresholdModulation(9,  S, I, T, SO, false, 0, false, true)).toBe(2);
    expect(applyThresholdModulation(10, S, I, T, SO, false, 0, false, true)).toBe(3);
    expect(applyThresholdModulation(11, S, I, T, SO, false, 0, false, true)).toBe(4);
  });

  it('leg 3 backward: effectiveStart shifted to 3, one-step range', () => {
    expect(applyThresholdModulation(12, S, I, T, SO, false, 0, false, true)).toBe(4);
    expect(applyThresholdModulation(13, S, I, T, SO, false, 0, false, true)).toBe(3);
  });

  it('without startOffset leg 1 starts at 0 and is longer', () => {
    // compare: same indices should differ between offset and no-offset
    const noOff = applyThresholdModulation(5, S, I, T, 0, false, 0, false, true);
    const withOff = applyThresholdModulation(5, S, I, T, SO, false, 0, false, true);
    expect(noOff).toBe(3);   // plain bounce: period=8, idx5→descending from 4 to 1 → 4-1=3
    expect(withOff).toBe(4); // offset bounce: leg 1 starts at threshold (shorter leg)
    expect(noOff).not.toBe(withOff);
  });
});

describe('applyThresholdModulation – bounce + startOffset (compound)', () => {
  // start=0, inc=1, threshold=10, startOffset=1 (compound=wrapCount²), bounce=true
  //
  // Leg 0 (wrapCount=0, forward)  effectiveStart=0+1×0=0,  steps=11, idx 0..10
  // Leg 1 (wrapCount=1, backward) effectiveStart=0+1×1=1,  steps=10, idx 11..20
  //   backward: value = effectiveThreshold – inc×localIndex = 10,9,…,1
  // Leg 2 (wrapCount=2, forward)  effectiveStart=0+1×4=4,  steps=7,  idx 21..27
  //   forward:  value = 4 + localIndex = 4,5,…,10

  const S = 0, I = 1, T = 10, SO = 1;

  it('leg 0: same as no-offset (wrapCount=0 → compound offset is 0)', () => {
    expect(applyThresholdModulation(0,  S, I, T, SO, true, 0, false, true)).toBe(0);
    expect(applyThresholdModulation(5,  S, I, T, SO, true, 0, false, true)).toBe(5);
    expect(applyThresholdModulation(10, S, I, T, SO, true, 0, false, true)).toBe(10);
  });

  it('leg 1 backward: effectiveStart=1 (1×1²=1), so 10 steps from threshold down to 1', () => {
    expect(applyThresholdModulation(11, S, I, T, SO, true, 0, false, true)).toBe(10);
    expect(applyThresholdModulation(15, S, I, T, SO, true, 0, false, true)).toBe(6);
    expect(applyThresholdModulation(20, S, I, T, SO, true, 0, false, true)).toBe(1);
  });

  it('leg 2 forward: effectiveStart=4 (1×2²=4), starts mid-range', () => {
    expect(applyThresholdModulation(21, S, I, T, SO, true, 0, false, true)).toBe(4);
    expect(applyThresholdModulation(24, S, I, T, SO, true, 0, false, true)).toBe(7);
    expect(applyThresholdModulation(27, S, I, T, SO, true, 0, false, true)).toBe(10);
  });

  it('compound shifts more aggressively than linear at wrapCount=2', () => {
    // compound effectiveStart=4 at leg2 vs linear effectiveStart=2 at leg2
    const compound = applyThresholdModulation(21, S, I, T, SO, true,  0, false, true);
    const linear   = applyThresholdModulation(21, S, I, T, SO, false, 0, false, true);
    expect(compound).toBeGreaterThan(linear);
  });
});

describe('applyThresholdModulation – bounce + wrapOffset (linear)', () => {
  // start=0, inc=1, threshold=4, wrapOffset=1 (linear), bounce=true
  //
  // Leg 0 (wrapCount=0, forward)  effectiveThreshold=4+1×0=4, steps=5
  //   idx 0..4  → 0,1,2,3,4
  // Leg 1 (wrapCount=1, backward) effectiveThreshold=4+1×1=5, steps=6
  //   backward: value=5 – localIndex → 5,4,3,2,1,0    idx 5..10
  // Leg 2 (wrapCount=2, forward)  effectiveThreshold=4+1×2=6, steps=7
  //   forward:  value=0+localIndex   → 0,1,2,3,4,5,6  idx 11..17

  const S = 0, I = 1, T = 4, WO = 1;

  it('leg 0: threshold unchanged at wrapCount=0', () => {
    expect(applyThresholdModulation(0, S, I, T, 0, false, WO, false, true)).toBe(0);
    expect(applyThresholdModulation(4, S, I, T, 0, false, WO, false, true)).toBe(4);
  });

  it('leg 1 backward: effectiveThreshold shifted to 5, longer backward leg', () => {
    expect(applyThresholdModulation(5,  S, I, T, 0, false, WO, false, true)).toBe(5);
    expect(applyThresholdModulation(7,  S, I, T, 0, false, WO, false, true)).toBe(3);
    expect(applyThresholdModulation(10, S, I, T, 0, false, WO, false, true)).toBe(0);
  });

  it('leg 2 forward: effectiveThreshold shifted to 6, even longer forward leg', () => {
    expect(applyThresholdModulation(11, S, I, T, 0, false, WO, false, true)).toBe(0);
    expect(applyThresholdModulation(14, S, I, T, 0, false, WO, false, true)).toBe(3);
    expect(applyThresholdModulation(17, S, I, T, 0, false, WO, false, true)).toBe(6);
  });

  it('leg 1 reaches higher peak than plain bounce at the same index', () => {
    // plain bounce period=8: idx5 → 3 (descending from 4)
    // wrapOffset bounce:     idx5 → 5 (peak of a larger leg)
    const plain   = applyThresholdModulation(5, S, I, T, 0, false, 0,  false, true);
    const shifted = applyThresholdModulation(5, S, I, T, 0, false, WO, false, true);
    expect(plain).toBe(3);
    expect(shifted).toBe(5);
    expect(shifted).toBeGreaterThan(plain);
  });
});

describe('applyThresholdModulation – bounce + wrapOffset (compound)', () => {
  // start=0, inc=1, threshold=4, wrapOffset=1 (compound=wrapCount²), bounce=true
  //
  // Leg 0 (wrapCount=0): effectiveThreshold=4+1×0=4, steps=5, idx 0..4 → 0,1,2,3,4
  // Leg 1 (wrapCount=1): effectiveThreshold=4+1×1=5, steps=6, backward, idx 5..10 → 5,4,3,2,1,0
  // Leg 2 (wrapCount=2): effectiveThreshold=4+1×4=8, steps=9, forward,  idx 11..19 → 0,1,2,3,4,5,6,7,8
  // Leg 3 (wrapCount=3): effectiveThreshold=4+1×9=13, steps=14, backward, idx 20..33 → 13,12,…

  const S = 0, I = 1, T = 4, WO = 1;

  it('leg 0: wrapCount=0 so compound offset is 0', () => {
    expect(applyThresholdModulation(0, S, I, T, 0, false, WO, true, true)).toBe(0);
    expect(applyThresholdModulation(4, S, I, T, 0, false, WO, true, true)).toBe(4);
  });

  it('leg 1: wrapCount=1, compound adds 1×1²=1 → effectiveThreshold=5', () => {
    expect(applyThresholdModulation(5,  S, I, T, 0, false, WO, true, true)).toBe(5);
    expect(applyThresholdModulation(8,  S, I, T, 0, false, WO, true, true)).toBe(2);
    expect(applyThresholdModulation(10, S, I, T, 0, false, WO, true, true)).toBe(0);
  });

  it('leg 2: wrapCount=2, compound adds 1×2²=4 → effectiveThreshold=8, 9 steps', () => {
    expect(applyThresholdModulation(11, S, I, T, 0, false, WO, true, true)).toBe(0);
    expect(applyThresholdModulation(15, S, I, T, 0, false, WO, true, true)).toBe(4);
    expect(applyThresholdModulation(19, S, I, T, 0, false, WO, true, true)).toBe(8);
  });

  it('leg 3: wrapCount=3, compound adds 1×3²=9 → effectiveThreshold=13', () => {
    expect(applyThresholdModulation(20, S, I, T, 0, false, WO, true, true)).toBe(13);
    expect(applyThresholdModulation(25, S, I, T, 0, false, WO, true, true)).toBe(8);
    expect(applyThresholdModulation(33, S, I, T, 0, false, WO, true, true)).toBe(0);
  });

  it('compound grows faster than linear: leg 2 peak is higher with compound', () => {
    // compound: effectiveThreshold at wrapCount=2 is 4+4=8
    // linear:   effectiveThreshold at wrapCount=2 is 4+2=6
    const compound = applyThresholdModulation(19, S, I, T, 0, false, WO, true,  true);
    const linear   = applyThresholdModulation(17, S, I, T, 0, false, WO, false, true);
    expect(compound).toBe(8);
    expect(linear).toBe(6);
    expect(compound).toBeGreaterThan(linear);
  });
});

describe('applyThresholdModulation – bounce + startOffset AND wrapOffset combined', () => {
  // start=0, inc=1, threshold=5, startOffset=1 (linear), wrapOffset=1 (linear), bounce=true
  //
  // Leg 0 (wrapCount=0, forward):  effectiveStart=0, effectiveThreshold=5, steps=6
  //   idx 0..5 → 0,1,2,3,4,5
  // Leg 1 (wrapCount=1, backward): effectiveStart=1, effectiveThreshold=6, steps=6
  //   backward: value = effectiveThreshold – inc×localIndex = 6,5,4,3,2,1
  //   idx 6..11
  // Leg 2 (wrapCount=2, forward):  effectiveStart=2, effectiveThreshold=7, steps=6
  //   forward: value = 2 + localIndex = 2,3,4,5,6,7
  //   idx 12..17

  const S = 0, I = 1, T = 5, SO = 1, WO = 1;

  it('leg 0: both offsets inactive at wrapCount=0', () => {
    expect(applyThresholdModulation(0, S, I, T, SO, false, WO, false, true)).toBe(0);
    expect(applyThresholdModulation(5, S, I, T, SO, false, WO, false, true)).toBe(5);
  });

  it('leg 1 backward: effectiveStart=1, effectiveThreshold=6 → peak at 6', () => {
    expect(applyThresholdModulation(6,  S, I, T, SO, false, WO, false, true)).toBe(6);
    expect(applyThresholdModulation(9,  S, I, T, SO, false, WO, false, true)).toBe(3);
    expect(applyThresholdModulation(11, S, I, T, SO, false, WO, false, true)).toBe(1);
  });

  it('leg 2 forward: effectiveStart=2, effectiveThreshold=7', () => {
    expect(applyThresholdModulation(12, S, I, T, SO, false, WO, false, true)).toBe(2);
    expect(applyThresholdModulation(17, S, I, T, SO, false, WO, false, true)).toBe(7);
  });
});

describe('_calcSquiggle bounce path – calculateSquiggleNoiseFreq', () => {
  // defaults: startValue=1, inc=0.5, modValue=10, driver='shapeIndex'
  // bounce at idx=21: period=20, rawPos=(0.5*21)%20=10.5>10, triPos=9.5, result=1+9.5=10.5
  // cycle  at idx=21: (0.5*21)%10=0.5, result=1+0.5=1.5
  const cycleS  = { ...base, strokeSquiggleNoiseFreqMode: 'incremental' as const, strokeSquiggleNoiseFreqModulationEnabled: true, strokeSquiggleBounce: false };
  const bounceS = { ...base, strokeSquiggleNoiseFreqMode: 'incremental' as const, strokeSquiggleNoiseFreqModulationEnabled: true, strokeSquiggleBounce: true };

  it('agree at index 0', () => {
    expect(calculateSquiggleNoiseFreq(cycleS, 0)).toBe(calculateSquiggleNoiseFreq(bounceS, 0));
  });

  it('diverge past modulation midpoint (idx=21)', () => {
    expect(calculateSquiggleNoiseFreq(cycleS, 21)).toBeCloseTo(1.5, 9);
    expect(calculateSquiggleNoiseFreq(bounceS, 21)).toBeCloseTo(10.5, 9);
    expect(calculateSquiggleNoiseFreq(cycleS, 21)).not.toBe(calculateSquiggleNoiseFreq(bounceS, 21));
  });

  it('bounce reverses: value decreases after peak at the modulation boundary', () => {
    expect(calculateSquiggleNoiseFreq(bounceS, 21)).toBeLessThan(calculateSquiggleNoiseFreq(bounceS, 20));
  });
});
