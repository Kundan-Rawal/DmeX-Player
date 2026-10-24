export const ACOUSTIC_ENVIRONMENTS = [
  { id:'NONE', label:'Off', path:'' },
  { id:'DTSXHeadphonewide', label:'DTS:X Headphone Wide', path:'resources/impulses/DTSXHeadphonewide.wav' },
  { id:'Head360', label:'Head-360 Surround', path:'resources/impulses/Head360.wav' },
  { id:'XHRQSurround', label:'XHR-QSurround', path:'resources/impulses/XHRQSurround.wav' },
  { id:'XHRStudioSurround', label:'XHR Studio Surround', path:'resources/impulses/XHRStudioSurround.wav' },
  { id:'dolbybassboost', label:'Dolby Bass Boost Room', path:'resources/impulses/dolbybassboost.wav' },
  { id:'dolbydimension', label:'Dolby Dimension Hall', path:'resources/impulses/dolbydimension.wav' },
  { id:'dolbyatmos', label:'Headphone Spatial IR', path:'resources/impulses/dolbyheadL.wav|resources/impulses/dolbyheadR.wav' },
  { id:'dolbyvirtualspeaker', label:'Dolby Virtual Speakers', path:'resources/impulses/dolbyvirtualspeakerL.wav|resources/impulses/dolbyvirtualspeakerR.wav' },
];

export const HEADPHONE_MODELS = [
  { id:'NONE', label:'Bypass (Direct Drivers)', path:'', desc:'No headphone EQ compensation applied' },
  { id:'AppleAirPods', label:'Apple AirPods', path:'resources/impulses/headphone_comp/AppleAirPods_harman_inv.wav', desc:'Linearizes frequency response to Harman Target curve' },
  { id:'AppleEarPods', label:'Apple EarPods', path:'resources/impulses/headphone_comp/AppleEarPods_harman_inv.wav', desc:'Linearizes frequency response to Harman Target curve' },
  { id:'Sony_WH1000XM2', label:'Sony WH-1000XM2 EQ Preset', path:'resources/impulses/headphone_comp/Sony_WH1000XM2_harman_inv.wav', desc:'Bundled inverse response; measurement provenance unverified' },
  { id:'SennheiserHD', label:'Sennheiser HD EQ Preset', path:'resources/impulses/headphone_comp/SennheiserHD_harman_inv.wav', desc:'Bundled inverse response; measurement provenance unverified' },
  { id:'AKGK240', label:'AKG K240 Studio', path:'resources/impulses/headphone_comp/AKGK240_harman_inv.wav', desc:'Fills sub-bass foundation & smooths upper-mid peak' },
  { id:'AKGK701', label:'AKG K701 EQ Preset', path:'resources/impulses/headphone_comp/AKGK701_harman_inv.wav', desc:'Bundled inverse response; measurement provenance unverified' },
  { id:'HyperXCloudalpha', label:'HyperX Cloud Alpha', path:'resources/impulses/headphone_comp/HyperXCloudalpha_harman_inv.wav', desc:'Flattens gaming V-shape to reference Harman target' },
  { id:'OppoPM3', label:'Oppo PM-3 Planar', path:'resources/impulses/headphone_comp/OppoPM3_harman_inv.wav', desc:'Planar magnetic target curve calibration' },
  { id:'SteelSeriesArctic9X', label:'SteelSeries Arctis 9X', path:'resources/impulses/headphone_comp/SteelSeriesArctic9X_harman_inv.wav', desc:'Harman reference linearization for Arctis wireless headset' },
  { id:'xiaomipiston2', label:'Xiaomi Piston 2 IEM', path:'resources/impulses/headphone_comp/xiaomipiston2_harman_inv.wav', desc:'In-ear Harman target response correction' },
];
