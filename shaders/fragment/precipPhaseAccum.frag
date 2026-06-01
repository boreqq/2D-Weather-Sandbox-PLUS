#version 300 es
precision highp float;

in vec4 data_out; // liquid, ice, density, diameter mm
in float compactness_out;
layout(location = 0) out vec4 phaseOut0; // R liquid sum, G ice sum, B compactness sum, A hail shaft tint signal
layout(location = 1) out vec4 phaseOut1; // R rho_i sum, G rho_i^2 sum, B compactness sum, A irregularity sum
layout(location = 2) out vec4 radarOut;  // R Zh, G Zv, B HV, A count
layout(location = 3) out vec4 sizeStatsOut; // R size sum, G size^2 sum

const float LIQUID_RADAR_SIZE_SCALE = 0.58;
const float ICE_RADAR_SIZE_SCALE_MIN = 0.42;
const float ICE_RADAR_SIZE_SCALE_MAX = 0.60;
const float MIXED_LIQUID_MOMENT_COEFF = 0.005;
const float FREE_LIQUID_MOMENT_COEFF = 1.0;
const float LIGHT_ICE_REFLECTIVITY_COEFF = 0.14;
const float DENSE_ICE_REFLECTIVITY_COEFF = 0.00005;

void hydrometeorMemberships(float liquid, float ice, float density, float size, float compactness, out vec4 primary, out vec2 secondary)
{
  float total = liquid + ice;
  if (total <= 0.0) {
    primary = vec4(0.0);
    secondary = vec2(0.0);
    return;
  }

  float liquidFraction = liquid / max(total, 1e-6);
  float iceFraction = ice / max(total, 1e-6);
  float compact = clamp(compactness, 0.0, 1.0);
  float diameterMm = max(size, 0.0);
  float dryIce = smoothstep(0.60, 0.98, iceFraction) * (1.0 - smoothstep(0.04, 0.20, liquidFraction));

  float rain = smoothstep(0.82, 0.995, liquidFraction) * (1.0 - smoothstep(0.05, 0.35, iceFraction));
  float wetHail = smoothstep(0.65, 0.98, iceFraction) * smoothstep(0.06, 0.35, liquidFraction) * smoothstep(0.78, 1.00, density) *
                  smoothstep(0.58, 0.88, compact) * smoothstep(3.5, 12.0, diameterMm);
  float classicHail = smoothstep(0.82, 1.00, density) * smoothstep(0.62, 0.92, compact) * smoothstep(3.5, 12.0, diameterMm);
  float denseSmallHail = smoothstep(0.86, 1.00, density) * smoothstep(0.42, 0.58, compact) * smoothstep(1.5, 2.5, diameterMm);
  float hail = dryIce * max(classicHail, denseSmallHail) *
               (1.0 - smoothstep(0.04, 0.16, liquidFraction)) * (1.0 - wetHail);
  float graupelSizeGate = smoothstep(1.2, 3.0, diameterMm) * (1.0 - smoothstep(4.5, 5.0, diameterMm));
  float graupel = dryIce * smoothstep(0.38, 0.82, density) * smoothstep(0.28, 0.78, compact) * graupelSizeGate *
                  (1.0 - hail) * (1.0 - wetHail);
  float melting = smoothstep(0.04, 0.40, liquidFraction) * smoothstep(0.30, 0.98, iceFraction) *
                  (1.0 - smoothstep(0.76, 1.00, compact) * smoothstep(0.82, 1.00, density));
  float snow = dryIce * (1.0 - smoothstep(0.45, 0.78, density)) * (1.0 - smoothstep(0.28, 0.72, compact)) *
               (1.0 - 0.75 * graupel) * (1.0 - 0.70 * melting);

  float sum = rain + snow + graupel + hail + wetHail + melting;
  if (sum <= 1e-6) {
    melting = step(1e-6, liquid) * step(1e-6, ice);
    hail = (1.0 - melting) * step(1e-6, ice) * step(0.78, density) * step(0.55, compact);
    rain = (1.0 - melting) * (1.0 - hail) * step(ice, liquid);
    snow = (1.0 - melting) * (1.0 - hail) * (1.0 - rain);
    graupel = 0.0;
    wetHail = 0.0;
    sum = 1.0;
  }

  primary = vec4(rain, snow, graupel, hail) / sum;
  secondary = vec2(wetHail, melting) / sum;
}

void main()
{
  if (data_out.x < 0.0) discard; // inactive drop

  float liquid = max(data_out.x, 0.0);
  float ice = max(data_out.y, 0.0);
  float density = max(data_out.z, 0.0);
  float size = max(data_out.w, 0.0);
  float compactness = clamp(compactness_out, 0.0, 1.0);
  float total = liquid + ice;
  float liquidFraction = liquid / max(total, 1e-6);
  float iceFraction = ice / max(total, 1e-6);

  vec4 primary;
  vec2 secondary;
  hydrometeorMemberships(liquid, ice, density, size, compactness, primary, secondary);

  float rainness = primary.r;
  float snowness = primary.g;
  float graupelness = primary.b;
  float hailness = primary.a;
  float wetHailness = secondary.r;
  float meltingness = secondary.g;

  float diameterMm = max(size, 0.0);
  float rainFlatten = clamp((diameterMm - 0.6) * 0.140, 0.0, 0.68);
  float mixedFlatten = clamp((diameterMm - 2.0) * 0.035, 0.0, 0.16);
  float snowFlatten = clamp((diameterMm - 3.0) * 0.008, 0.0, 0.05);
  float flattening = rainFlatten * rainness +
                     mixedFlatten * (meltingness * 0.55 + wetHailness * 0.18) +
                     snowFlatten * (snowness * 0.70 + graupelness * 0.35);

  float radarPresence = smoothstep(0.12, 0.35, total);
  float waterSize = diameterMm * pow(max(liquidFraction, 0.0), 1.0 / 3.0);
  float iceSize = diameterMm * pow(max(iceFraction, 0.0), 1.0 / 3.0);

  float freeLiquidFactor = smoothstep(0.30, 0.90, liquidFraction);
  float liquidMomentCoeff = mix(MIXED_LIQUID_MOMENT_COEFF, FREE_LIQUID_MOMENT_COEFF, freeLiquidFactor);
  float waterMoment = pow(max(waterSize * LIQUID_RADAR_SIZE_SCALE, 1e-4), 6.0) * liquidMomentCoeff;
  float iceDensity = clamp(density, 0.12, 1.0);
  float aggregateBoost = mix(1.42, 1.08, clamp(0.35 * compactness + 0.65 * iceDensity, 0.0, 1.0));
  float iceRadarSize = iceSize * mix(ICE_RADAR_SIZE_SCALE_MIN, ICE_RADAR_SIZE_SCALE_MAX, iceDensity) * aggregateBoost;
  float compactDenseIce = smoothstep(0.72, 0.90, iceDensity) *
                          smoothstep(0.35, 0.65, compactness) *
                          smoothstep(2.0, 8.0, diameterMm);
  float densityDominantIce = smoothstep(0.84, 0.96, iceDensity) *
                             smoothstep(4.0, 10.0, diameterMm);
  float denseIceFactor = max(compactDenseIce, densityDominantIce);
  float iceCoeff = mix(LIGHT_ICE_REFLECTIVITY_COEFF, DENSE_ICE_REFLECTIVITY_COEFF, denseIceFactor);
  float iceMoment = iceCoeff * pow(max(iceRadarSize, 1e-4), 6.0);

  float brightBand = meltingness * 0.08 + wetHailness * 0.05;

  float largeRainTail = smoothstep(2.1, 4.0, diameterMm);
  float giantRainTail = smoothstep(3.4, 5.8, diameterMm);
  float meltingTail = smoothstep(3.0, 6.0, diameterMm);
  float rainZdr = mix(0.20, 3.55, smoothstep(0.45, 3.2, diameterMm)) + flattening * 1.45 + largeRainTail * 1.55 + giantRainTail * 3.10;
  float meltingZdr = mix(0.22, 1.55, smoothstep(1.0, 6.0, diameterMm)) + flattening * 0.82 + meltingTail * 0.22;
  float wetHailZdr = mix(-0.10, 0.45, smoothstep(5.0, 25.0, diameterMm)) + flattening * 0.25;
  float snowZdr = mix(-0.08, 0.32, smoothstep(1.0, 12.0, diameterMm)) - smoothstep(0.65, 0.95, density) * 0.10;
  float graupelZdr = mix(-0.18, 0.12, smoothstep(1.5, 10.0, diameterMm)) - smoothstep(0.60, 0.95, compactness) * 0.05;
  float hailZdr = -mix(0.02, 0.35, smoothstep(5.0, 35.0, diameterMm));

  float targetZdrDb = rainness * rainZdr +
                      snowness * snowZdr +
                      graupelness * graupelZdr +
                      hailness * hailZdr +
                      wetHailness * wetHailZdr +
                      meltingness * meltingZdr;
  targetZdrDb = clamp(targetZdrDb, -1.25, 7.00);

  float baseMoment = radarPresence * (waterMoment + iceMoment) * (1.0 + brightBand * 0.85);
  float zdrRatio = pow(10.0, targetZdrDb / 10.0);
  float zh = baseMoment * (2.0 * zdrRatio / (1.0 + zdrRatio));
  float zv = baseMoment * (2.0 / (1.0 + zdrRatio));

  float particleRho = clamp(
    rainness * mix(0.992, 0.986, smoothstep(1.0, 6.0, diameterMm)) +
    snowness * mix(0.985, 0.974, smoothstep(1.0, 10.0, diameterMm)) +
    graupelness * mix(0.964, 0.940, smoothstep(1.5, 8.0, diameterMm)) +
    hailness * mix(0.950, 0.900, smoothstep(5.0, 30.0, diameterMm)) +
    wetHailness * mix(0.930, 0.840, smoothstep(5.0, 30.0, diameterMm)) +
    meltingness * mix(0.940, 0.870, smoothstep(0.10, 0.45, liquidFraction)) -
    rainness * flattening * 0.04,
    0.0, 1.0
  );

  float hv = particleRho * sqrt(max(zh * zv, 0.0));
  float irregularity = graupelness * 0.45 + hailness * 0.70 + wetHailness * 1.00 + meltingness * 0.85;
  float hailClass = clamp(hailness + wetHailness, 0.0, 1.0);
  float hailSizeSignal = smoothstep(2.0, 28.0, diameterMm);
  float largeHailSignal = smoothstep(10.0, 42.0, diameterMm);
  float hailMassSignal = smoothstep(0.02, 0.55, total);
  float hailDensitySignal = mix(0.62, 1.0, smoothstep(0.65, 1.0, density));
  float hailShaft = hailClass * hailMassSignal * hailDensitySignal *
                    mix(0.32, 1.55, hailSizeSignal) *
                    (1.0 + largeHailSignal * 0.75);

  phaseOut0 = vec4(liquid, ice, compactness, hailShaft);
  phaseOut1 = vec4(particleRho, particleRho * particleRho, compactness, irregularity);
  radarOut = vec4(zh, zv, hv, 1.0);
  float sizeStatsWeight = sqrt(max(zh + zv, 0.0));
  sizeStatsOut = vec4(diameterMm * sizeStatsWeight, diameterMm * diameterMm * sizeStatsWeight, sizeStatsWeight, 0.0);
}
