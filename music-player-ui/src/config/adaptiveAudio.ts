export interface AdaptiveSource { path: string; generation: number }
export interface TrackAnalysis {
  version: number; sampledSeconds: number; activeSeconds: number; confidence: number;
  samplePeakDbfs: number; crestDb: number; correlation: number; eqDb: number[]; reasons: string[];
}
export function validAnalysis(value: unknown): value is TrackAnalysis {
  if (!value || typeof value !== 'object') return false;
  const a=value as TrackAnalysis;
  return a.version===1 && Array.isArray(a.eqDb) && a.eqDb.length===4 &&
    a.eqDb.every(v=>Number.isFinite(v)&&v>=-3&&v<=0) && a.eqDb.reduce((sum,v)=>sum+Math.abs(v),0)<=3.00001 && Number.isFinite(a.confidence) &&
    a.confidence>=0 && a.confidence<=1 && Number.isFinite(a.activeSeconds) && a.activeSeconds>=0;
}
export function adaptiveCommand(source: AdaptiveSource, enabled: boolean, analysis: TrackAnalysis | null, strength=1): string {
  const trusted=enabled && validAnalysis(analysis) && analysis.confidence>=.8;
  const eq=trusted ? analysis.eqDb.map(v=>v*Math.max(0,Math.min(1,strength))) : [0,0,0,0];
  return `ADAPTIVE_EQ ${source.generation} ${trusted ? 1 : 0} ${eq.map(v=>v.toFixed(5)).join(' ')}`;
}
