use crate::audio_stream::AudioStream;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::{fs, hash::{Hash, Hasher}, path::Path, sync::Mutex, time::{Duration, Instant}};

const VERSION: u32 = 1;
const RATE: u32 = 22050;
const FFT: usize = 2048;
static WORKER: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub version: u32,
    pub sampled_seconds: f64,
    pub active_seconds: f64,
    pub confidence: f64,
    pub sample_peak_dbfs: f64,
    pub crest_db: f64,
    pub correlation: f64,
    pub eq_db: [f64; 4],
    pub reasons: Vec<String>,
}

struct Measurements {
    frames: u64, active: u64, peak: f64, energy: f64,
    l2: f64, r2: f64, lr: f64,
    votes: [u64; 4], severity: [f64; 4],
}
impl Measurements {
    fn new() -> Self { Self { frames: 0, active: 0, peak: 0.0, energy: 0.0, l2: 0.0, r2: 0.0, lr: 0.0, votes: [0; 4], severity: [0.0; 4] } }
    fn observe(&mut self, samples: &[f32], channels: usize, fft: &dyn rustfft::Fft<f64>, work: &mut [Complex<f64>], scratch: &mut [Complex<f64>]) -> Result<(), String> {
        let frames = samples.len()/channels;
        if frames != FFT { return Ok(()); }
        let mut energy=0.0;
        for i in 0..frames {
            let l=samples[i*channels] as f64;
            let r=samples[i*channels+channels-1] as f64;
            if !l.is_finite() || !r.is_finite() { return Err("Invalid PCM during analysis".into()); }
            self.peak=self.peak.max(l.abs()).max(r.abs());
            self.l2+=l*l; self.r2+=r*r; self.lr+=l*r;
            energy+=(l*l+r*r)*0.5;
        }
        self.energy+=energy; self.frames+=frames as u64;
        if energy/(frames as f64) < 1e-7 { return Ok(()); }
        self.active+=1;
        let mut bands=[0.0f64; 6];
        let mut log_high=0.0; let mut high_sum=0.0; let mut high_bins=0;
        // Analyse L/R power separately. Mid-only analysis would lose anti-phase content.
        for channel in 0..channels {
            for (i, value) in work.iter_mut().enumerate() {
                let window=0.5-0.5*(std::f64::consts::TAU*i as f64/(FFT-1) as f64).cos();
                *value=Complex::new(samples[i*channels+channel] as f64*window,0.0);
            }
            fft.process_with_scratch(work,scratch);
            for (i, value) in work.iter().enumerate().take(FFT/2).skip(1) {
                let hz=i as f64*RATE as f64/FFT as f64;
                let band=if hz<40.0 { continue } else if hz<160.0 {0} else if hz<500.0 {1} else if hz<1800.0 {2} else if hz<5000.0 {3} else if hz<8000.0 {4} else {5};
                let power=value.norm_sqr(); bands[band]+=power;
                if hz>=5000.0 { log_high+=(power+1e-20).ln(); high_sum+=power; high_bins+=1; }
            }
        }
        let db=|a:f64,b:f64| 10.0*((a+1e-16)/(b+1e-16)).log10();
        let ratios=[db(bands[0],bands[1]+bands[2]),db(bands[1],bands[2]+bands[3]),db(bands[3],bands[1]+bands[2]),db(bands[4]+bands[5],bands[2]+bands[3])];
        let thresholds=[9.0,8.0,6.0,5.0];
        let flatness=if high_bins>0 { (log_high/high_bins as f64).exp()/(high_sum/high_bins as f64+1e-20) } else {0.0};
        for band in 0..4 {
            // A sustained broad high-frequency excess is required, not a single cymbal hit.
            if ratios[band]>thresholds[band] && (band!=3 || flatness>0.35) {
                self.votes[band]+=1;
                self.severity[band]+=(ratios[band]-thresholds[band]).min(12.0);
            }
        }
        Ok(())
    }
    fn finish(&self) -> Analysis {
        let active_seconds=self.active as f64*FFT as f64/RATE as f64;
        let confidence=((active_seconds-6.0)/12.0).clamp(0.0,1.0);
        let mut eq=[0.0;4]; let mut reasons=Vec::new();
        let descriptions=["Persistent low-frequency dominance", "Persistent low-mid dominance", "Persistent upper-mid dominance", "Persistent broadband high-frequency excess"];
        for band in 0..4 {
            let persistence=self.votes[band] as f64/self.active.max(1) as f64;
            if confidence>=0.8 && persistence>=0.85 {
                let excess=self.severity[band]/self.votes[band].max(1) as f64;
                eq[band]=-(excess*0.25*confidence).min(if band==2 {1.0} else {1.5});
                if eq[band]>-0.25 { eq[band]=0.0; } else { reasons.push(descriptions[band].into()); }
            }
        }
        // Bound the cumulative correction; no fixed target spectrum or automatic boosts.
        let total: f64=eq.iter().map(|v| v.abs()).sum();
        if total>3.0 { for db in &mut eq { *db*=3.0/total; } }
        let rms=(self.energy/self.frames.max(1) as f64).sqrt();
        Analysis { version: VERSION, sampled_seconds:self.frames as f64/RATE as f64, active_seconds, confidence,
            sample_peak_dbfs:20.0*self.peak.max(1e-10).log10(),
            crest_db:if rms>1e-10 {20.0*(self.peak/rms).max(1e-10).log10()} else {0.0},
            correlation:(self.lr/(self.l2*self.r2).sqrt().max(1e-20)).clamp(-1.0,1.0), eq_db:eq, reasons }
    }
}

pub fn analyze(path: &str, identity: &str, cache: &Path, current: impl Fn() -> bool) -> Result<Analysis,String> {
    // One analysis job at a time; never on the playback owner/callback.
    let _worker=WORKER.lock().map_err(|_| "Analysis worker interrupted")?;
    if !current() { return Err("Analysis superseded".into()); }
    let metadata=fs::metadata(path).map_err(|e| e.to_string())?;
    let mut hash=std::collections::hash_map::DefaultHasher::new();
    VERSION.hash(&mut hash); identity.hash(&mut hash); metadata.len().hash(&mut hash); metadata.modified().ok().hash(&mut hash);
    #[cfg(unix)] { use std::os::unix::fs::MetadataExt; metadata.dev().hash(&mut hash); metadata.ino().hash(&mut hash); }
    let file=cache.join(format!("{:016x}.json",hash.finish()));
    if let Ok(bytes)=fs::read(&file) {
        if bytes.len()<16384 { if let Ok(value)=serde_json::from_slice::<Analysis>(&bytes) {
            if value.version==VERSION && value.eq_db.iter().all(|db| db.is_finite() && (-3.0..=0.0).contains(db)) { return Ok(value); }
        } }
    }
    let mut stream=AudioStream::open(path,RATE)?;
    let mut samples=vec![0.0f32;FFT*stream.channels];
    let fft=FftPlanner::<f64>::new().plan_fft_forward(FFT);
    let mut work=vec![Complex::default();FFT];
    let mut scratch=vec![Complex::default();fft.get_inplace_scratch_len()];
    let mut measurements=Measurements::new();
    let started=Instant::now();
    let mut reached_end=false;
    while measurements.frames<(RATE as u64*36) {
        if !current() { return Err("Analysis superseded".into()); }
        if started.elapsed()>Duration::from_secs(3) { break; }
        let count=stream.read(FFT,Some(&mut samples))?;
        if count<FFT { reached_end=true; break; }
        measurements.observe(&samples,stream.channels,fft.as_ref(),&mut work,&mut scratch)?;
        std::thread::yield_now();
    }
    let result=measurements.finish();
    if measurements.frames==0 { return Err("No analysable PCM".into()); }
    if current() && (reached_end || result.active_seconds>=18.0) && fs::create_dir_all(cache).is_ok() {
        if let Ok(bytes)=serde_json::to_vec(&result) { let _=fs::write(&file,bytes); }
        let mut entries:Vec<_>=fs::read_dir(cache).into_iter().flatten().filter_map(Result::ok)
            .filter(|entry| entry.path().extension().and_then(|v| v.to_str())==Some("json"))
            .filter_map(|entry| entry.metadata().ok().map(|meta|(entry.path(),meta.modified().ok()))).collect();
        entries.sort_by_key(|entry| entry.1);
        let excess=entries.len().saturating_sub(256);
        for (path,_) in entries.into_iter().take(excess) { if path!=file { let _=fs::remove_file(path); } }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(seconds:usize, frequencies:&[(f64,f64)], invert:bool) -> Analysis {
        let fft=FftPlanner::<f64>::new().plan_fft_forward(FFT);
        let mut work=vec![Complex::default();FFT]; let mut scratch=vec![Complex::default();fft.get_inplace_scratch_len()];
        let mut data=vec![0.0f32;FFT*2]; let mut measurement=Measurements::new();
        for block in 0..seconds*RATE as usize/FFT {
            for i in 0..FFT {
                let t=(block*FFT+i) as f64/RATE as f64;
                let value=frequencies.iter().map(|(hz,amp)|amp*(std::f64::consts::TAU*hz*t).sin()).sum::<f64>() as f32;
                data[2*i]=value; data[2*i+1]=if invert {-value} else {value};
            }
            measurement.observe(&data,2,fft.as_ref(),&mut work,&mut scratch).unwrap();
        }
        measurement.finish()
    }
    #[test] fn silence_and_short_material_remain_unchanged() {
        assert_eq!(fixture(20,&[],false).eq_db,[0.0;4]);
        assert_eq!(fixture(4,&[(70.0,0.5)],false).eq_db,[0.0;4]);
    }
    #[test] fn balanced_signal_is_not_forced_to_a_target_curve() {
        let a=fixture(22,&[(70.0,0.1),(300.0,0.1),(900.0,0.1),(3000.0,0.1),(7000.0,0.05)],false);
        assert_eq!(a.eq_db,[0.0;4]); assert!(a.confidence>0.9);
    }
    #[test] fn sustained_excess_is_bounded_and_never_boosted() {
        let a=fixture(22,&[(70.0,0.5),(900.0,0.01)],false);
        assert!(a.eq_db[0] < -0.25); assert!(a.eq_db.iter().all(|v|(-1.5..=0.0).contains(v)));
        assert!(a.eq_db.iter().map(|v|v.abs()).sum::<f64>()<=3.0);
    }
    #[test] fn anti_phase_audio_is_not_mistaken_for_silence() {
        let a=fixture(22,&[(70.0,0.5),(900.0,0.01)],true);
        assert!(a.correlation < -0.99); assert!(a.active_seconds>20.0); assert!(a.eq_db[0]<0.0);
    }
    #[test] fn invalid_pcm_is_rejected() {
        let fft=FftPlanner::<f64>::new().plan_fft_forward(FFT);
        let mut work=vec![Complex::default();FFT]; let mut scratch=vec![Complex::default();fft.get_inplace_scratch_len()];
        assert!(Measurements::new().observe(&vec![f32::NAN;FFT*2],2,fft.as_ref(),&mut work,&mut scratch).is_err());
    }
    #[test] fn supplied_recording_analysis() {
        let Ok(path)=std::env::var("DMEX_ANALYSIS_SONG") else { return; };
        let cache=std::env::temp_dir().join("dmex-analysis-test");
        let started=Instant::now();
        let first=analyze(&path,&path,&cache,||true).unwrap();
        println!("SONG_ANALYSIS {} elapsed_ms={}",serde_json::to_string(&first).unwrap(),started.elapsed().as_millis());
        let second=analyze(&path,&path,&cache,||true).unwrap();
        assert_eq!(first.eq_db,second.eq_db);
        assert!(analyze(&path,&path,&cache,||false).is_err());
    }
}
