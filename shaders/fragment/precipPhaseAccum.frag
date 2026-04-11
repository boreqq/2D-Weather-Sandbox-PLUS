#version 300 es
precision highp float;

in vec4 data_out; // liquid, ice, density, size
in float compactness_out;
layout(location = 0) out vec4 phaseOut0; // R liquid sum, G ice sum, B compactness sum, A irregularity sum
layout(location = 1) out vec4 phaseOut1; // R rho_i sum, G rho_i^2 sum, B compactness sum, A irregularity sum
layout(location = 2) out vec4 radarOut;  // R Zh, G Zv, B HV, A count

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
  float dryIce = smoothstep(0.60, 0.98, iceFraction) * (1.0 - smoothstep(0.04, 0.20, liquidFraction));

  float rain = smoothstep(0.82, 0.995, liquidFraction) * (1.0 - smoothstep(0.05, 0.35, iceFraction));
  float wetHail = smoothstep(0.65, 0.98, iceFraction) * smoothstep(0.06, 0.35, liquidFraction) * smoothstep(0.78, 1.00, density) *
                  smoothstep(0.70, 1.00, compact) * smoothstep(0.55, 1.10, size);
  float hail = dryIce * smoothstep(0.82, 1.00, density) * smoothstep(0.72, 1.00, compact) * smoothstep(0.55, 1.10, size) *
               (1.0 - smoothstep(0.04, 0.16, liquidFraction)) * (1.0 - wetHail);
  float graupel = dryIce * smoothstep(0.38, 0.82, density) * smoothstep(0.28, 0.78, compact) * smoothstep(0.30, 0.90, size) *
                  (1.0 - hail) * (1.0 - wetHail);
  float melting = smoothstep(0.04, 0.40, liquidFraction) * smoothstep(0.30, 0.98, iceFraction) *
                  (1.0 - smoothstep(0.76, 1.00, compact) * smoothstep(0.82, 1.00, density));
  float snow = dryIce * (1.0 - smoothstep(0.45, 0.78, density)) * (1.0 - smoothstep(0.28, 0.72, compact)) *
               (1.0 - 0.75 * graupel) * (1.0 - 0.70 * melting);

  float sum = rain + snow + graupel + hail + wetHail + melting;
  if (sum <= 1e-6) {
    rain = step(ice, liquid);
    snow = 1.0 - rain;
    graupel = 0.0;
    hail = 0.0;
    wetHail = 0.0;
    melting = 0.0;
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

  float rainFlatten = clamp((size - 0.45) * 0.35, 0.0, 0.22);
  float mixedFlatten = clamp((size - 0.50) * 0.18, 0.0, 0.10);
  float snowFlatten = clamp((size - 0.60) * 0.08, 0.0, 0.04);
  float flattening = rainFlatten * rainness +
                     mixedFlatten * (meltingness * 0.55 + wetHailness * 0.18) +
                     snowFlatten * (snowness * 0.70 + graupelness * 0.35);

  float radarPresence = smoothstep(0.12, 0.35, total);
  float waterSize = size * pow(max(liquidFraction, 0.0), 1.0 / 3.0);
  float iceSize = size * pow(max(iceFraction, 0.0), 1.0 / 3.0);

  float waterMoment = pow(max(waterSize * 0.58, 1e-4), 6.0);
  float iceDensity = clamp(density, 0.12, 1.0);
  float aggregateBoost = mix(1.42, 1.08, clamp(0.35 * compactness + 0.65 * iceDensity, 0.0, 1.0));
  float iceRadarSize = iceSize * mix(0.42, 0.60, iceDensity) * aggregateBoost;
  float iceCoeff = snowness * 0.14 + graupelness * 0.20 + hailness * 0.28 + wetHailness * 0.31 + meltingness * 0.22;
  float iceMoment = iceCoeff * pow(max(iceRadarSize, 1e-4), 6.0);

  float brightBand = meltingness * 0.08 + wetHailness * 0.05;

  float baseMoment = radarPresence * (waterMoment + iceMoment);
  float zh = baseMoment * (1.0 + brightBand + flattening * 0.04);
  float zv = radarPresence * (waterMoment * max(1.0 - flattening * 0.55, 0.60) + iceMoment * max(1.0 - flattening * 0.10, 0.90));
  zv *= (1.0 + brightBand * 0.65);

  float particleRho = clamp(
    rainness * mix(0.992, 0.986, smoothstep(0.50, 1.80, size)) +
    snowness * mix(0.985, 0.974, smoothstep(0.35, 1.30, size)) +
    graupelness * mix(0.964, 0.940, smoothstep(0.40, 1.60, size)) +
    hailness * mix(0.950, 0.900, smoothstep(0.55, 1.90, size)) +
    wetHailness * mix(0.930, 0.840, smoothstep(0.55, 1.90, size)) +
    meltingness * mix(0.940, 0.870, smoothstep(0.10, 0.45, liquidFraction)) -
    rainness * flattening * 0.04,
    0.0, 1.0
  );

  float hv = particleRho * sqrt(max(zh * zv, 0.0));
  float irregularity = graupelness * 0.45 + hailness * 0.70 + wetHailness * 1.00 + meltingness * 0.85;

  phaseOut0 = vec4(liquid, ice, compactness, irregularity);
  phaseOut1 = vec4(particleRho, particleRho * particleRho, compactness, irregularity);
  radarOut = vec4(zh, zv, hv, 1.0);
}
