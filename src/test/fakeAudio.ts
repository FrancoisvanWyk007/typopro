/**
 * Minimal Web Audio fakes for lifecycle tests. They record what the engine
 * schedules; they do not produce sound.
 */

export class FakeParam {
  value: number;
  calls: { method: string; args: number[] }[] = [];
  constructor(value = 0) {
    this.value = value;
  }
  private log(method: string, args: number[]) {
    this.calls.push({ method, args });
    return this;
  }
  setValueAtTime(v: number, t: number) {
    return this.log('setValueAtTime', [v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v;
    return this.log('linearRampToValueAtTime', [v, t]);
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.value = v;
    return this.log('setTargetAtTime', [v, t, tc]);
  }
  cancelScheduledValues(t: number) {
    return this.log('cancelScheduledValues', [t]);
  }
}

export class FakeNode {
  outputs = new Set<FakeNode>();
  disconnected = false;
  connect<T extends FakeNode>(node: T): T {
    this.outputs.add(node);
    return node;
  }
  disconnect() {
    this.outputs.clear();
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  startArgs: [number, number] | null = null;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  start(when: number, offset: number) {
    this.startArgs = [when, offset];
  }
  stop(when: number) {
    this.stopAt = when;
  }
}

export class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  getFloatTimeDomainData(arr: Float32Array) {
    arr.fill(0.5);
  }
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: 'running' | 'suspended' | 'closed' = 'suspended';
  outputLatency = 0.02;
  baseLatency = 0.005;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  outputStamp: { contextTime: number; performanceTime: number } | null = null;

  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam(0) });
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  createDynamicsCompressor() {
    const n = new FakeNode();
    return Object.assign(n, {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
  getOutputTimestamp() {
    return this.outputStamp ?? { contextTime: 0, performanceTime: 0 };
  }
  async resume() {
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
}

export const fakeBuffer = (duration: number) => ({ duration }) as unknown as AudioBuffer;
