import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add isBooted state
content = content.replace(
  "const [isDarkMode, setIsDarkMode]         = useState(true);",
  "const [isDarkMode, setIsDarkMode]         = useState(true);\n  const [isBooted, setIsBooted]             = useState(false);"
);

// 2. Modify boot sequence
const bootRegex = /try \{\s*await initVault\(\);\s*const savedDark = await vaultGet<boolean>\("isDarkMode"\);\s*if \(savedDark !== undefined && savedDark !== null\) setIsDarkMode\(savedDark\);\s*\} catch \(err\) \{\}/;

const bootReplacement = `try {
        await initVault();
        const settings = await vaultGet<any>('app_settings');
        if (settings) {
          if (settings.isDarkMode !== undefined) setIsDarkMode(settings.isDarkMode);
          if (settings.bassLevel !== undefined) { setBassLevel(settings.bassLevel); bassLevelRef.current = settings.bassLevel; }
          if (settings.trebleLevel !== undefined) { setTrebleLevel(settings.trebleLevel); trebleLevelRef.current = settings.trebleLevel; }
          if (settings.speakerMode !== undefined) { setSpeakerMode(settings.speakerMode); speakerModeRef.current = settings.speakerMode; }
          
          if (settings.isRemastered !== undefined) setIsRemastered(settings.isRemastered);
          if (settings.isCompressed !== undefined) setIsCompressed(settings.isCompressed);
          if (settings.upscaleDrive !== undefined) setUpscaleDrive(settings.upscaleDrive);
          if (settings.widenWidth !== undefined) setWidenWidth(settings.widenWidth);
          if (settings.spatialExtra !== undefined) setSpatialExtra(settings.spatialExtra);
          if (settings.reverbWet !== undefined) setReverbWet(settings.reverbWet);
          
          if (settings.restorationDenoise !== undefined) setRestorationDenoise(settings.restorationDenoise);
          if (settings.restorationUpscale !== undefined) setRestorationUpscale(settings.restorationUpscale);
          if (settings.restorationPresence !== undefined) setRestorationPresence(settings.restorationPresence);
          
          if (settings.selectedAcousticEnv !== undefined) setSelectedAcousticEnv(settings.selectedAcousticEnv);
          if (settings.smartTaste !== undefined) { setSmartTaste(settings.smartTaste); smartTasteRef.current = settings.smartTaste; }
          if (settings.isManualOverride !== undefined) setIsManualOverride(settings.isManualOverride);
          if (settings.visMode !== undefined) setVisMode(settings.visMode);
          if (settings.sortMode !== undefined) setSortMode(settings.sortMode);
          if (settings.volume !== undefined) { setVolume(settings.volume); volumeRef.current = settings.volume; }
          if (settings.isPhoneSpeaker !== undefined) { setIsPhoneSpeaker(settings.isPhoneSpeaker); isPhoneSpeakerRef.current = settings.isPhoneSpeaker; }

          if (settings.lastTrackPath) {
             // We use a timeout to ensure playlist is fully loaded into state
             setTimeout(async () => {
                 const currentPl = playlistRef.current;
                 const track = currentPl.find((t: any) => t.path === settings.lastTrackPath);
                 if (track) {
                     setCurrentTrack(track);
                     setTrackTitle(track.name);
                     setTrackArtist(track.artist);
                     setLyrics(track.lyrics?.length ? track.lyrics : []);
                     if (track.profile) {
                         const p = PROFILES.find((pr: any) => pr.id === track.profile);
                         if (p) setDetectedProfile(p);
                     }
                     try {
                         await writeToEngine(\`VOLUME \${settings.volume ?? 1.0}\`);
                         await writeToEngine(\`REMASTER \${settings.isRemastered ? 1 : 0}\`);
                         await writeToEngine(\`COMPRESS \${settings.isCompressed ? 1 : 0}\`);
                         await writeToEngine(\`UPSCALE \${settings.upscaleDrive || 0}\`);
                         await writeToEngine(\`WIDEN \${settings.widenWidth || 1.0}\`);
                         await writeToEngine(\`3D \${settings.spatialExtra || 0}\`);
                         await writeToEngine(\`REVERB \${settings.reverbWet || 0}\`);
                         await writeToEngine(\`BASS \${settings.bassLevel ?? 0.25}\`);
                         await writeToEngine(\`TREBLE \${settings.trebleLevel ?? 0.0}\`);
                         await writeToEngine(\`LIMITER \${settings.speakerMode==='NONE'?0:settings.speakerMode==='LOW'?0.3:settings.speakerMode==='MED'?0.6:1.0}\`);
                         await writeToEngine(\`ANDROID_SPEAKER \${settings.isPhoneSpeaker ? 1 : 0}\`);
                         await writeToEngine(\`LOAD \${track.path}\`);
                     } catch (_) {}
                 }
             }, 500);
          }
        } else {
            // Fallback for older single-key saved settings
            const savedDark = await vaultGet<boolean>("isDarkMode");
            if (savedDark !== undefined && savedDark !== null) setIsDarkMode(savedDark);
        }
      } catch (err) {}
      
      setIsBooted(true);`;

content = content.replace(bootRegex, bootReplacement);

// 3. Add Settings Persister useEffect
const persisterCode = `
  // 1.1 SETTINGS PERSISTER
  useEffect(() => {
    if (!isBooted) return;
    const settings = {
        isDarkMode, bassLevel, trebleLevel, speakerMode,
        isRemastered, isCompressed, upscaleDrive, widenWidth,
        spatialExtra, reverbWet, restorationDenoise, restorationUpscale,
        restorationPresence, selectedAcousticEnv, smartTaste,
        isManualOverride, visMode, sortMode, volume, isPhoneSpeaker,
        lastTrackPath: currentTrack?.path || null
    };
    vaultSet('app_settings', settings).catch(()=>{});
  }, [
    isBooted, isDarkMode, bassLevel, trebleLevel, speakerMode,
    isRemastered, isCompressed, upscaleDrive, widenWidth,
    spatialExtra, reverbWet, restorationDenoise, restorationUpscale,
    restorationPresence, selectedAcousticEnv, smartTaste,
    isManualOverride, visMode, sortMode, volume, isPhoneSpeaker,
    currentTrack
  ]);
`;

content = content.replace("// 1. THE BOOT SEQUENCE", persisterCode + "\n\n  // 1. THE BOOT SEQUENCE");

fs.writeFileSync('src/App.tsx', content);
