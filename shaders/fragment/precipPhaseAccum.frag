#version 300 es
precision highp float;

in vec4 data_out; // liquid, ice, density, size
layout(location = 0) out vec4 phaseOut0; // R liquid sum, G ice sum, B -, A -
layout(location = 1) out vec4 phaseOut1; // R log(Zh/Zv) sum, G log(Zh/Zv)^2 sum, B -, A -
layout(location = 2) out vec4 radarOut;  // R Zh, G Zv, B sqrt(Zh*Zv), A count

void main()
{
  if (data_out.x < 0.0) discard; // inactive drop

  float liquid = max(data_out.x, 0.0);
  float ice = max(data_out.y, 0.0);
  float density = max(data_out.z, 0.0);
  float size = max(data_out.w, 0.0);
  float total = liquid + ice;
  float liquidFraction = liquid / max(total, 1e-6);
  float iceFraction = ice / max(total, 1e-6);
  float snowiness = clamp((0.95 - density) / 0.83, 0.0, 1.0);

  float flattening = 0.0;
  if (liquidFraction > 0.7) {
    flattening = clamp((size - 0.45) * 0.35, 0.0, 0.22);
  } else if (liquid > 0.0 && ice > 0.0) {
    flattening = clamp((size - 0.50) * 0.18, 0.0, 0.10);
  } else if (iceFraction > 0.99 && density < 0.95) {
    flattening = clamp((size - 0.60) * 0.08, 0.0, 0.04);
  }

  // Suppress fresh/tiny particles so reflectivity does not instantly appear
  // everywhere new particles spawn inside cloud, but allow upper-level ice to
  // show a weak-to-moderate echo instead of disappearing completely.
  float radarPresence = smoothstep(0.12, 0.35, total);

  // Split the packet into separate liquid/ice radar contributors.
  // Water has a much stronger dielectric response than dry ice, while mixed-phase
  // should only create a modest bright band instead of a detached strong stripe.
  float waterSize = size * pow(max(liquidFraction, 0.0), 1.0 / 3.0);
  float iceSize = size * pow(max(iceFraction, 0.0), 1.0 / 3.0);

  // Keep rain stronger than dry ice/snow, but avoid over-damping upper-level ice.
  // Fluffier snow aggregates should still be visible aloft in reflectivity.
  float waterMoment = pow(max(waterSize * 0.58, 1e-4), 6.0);
  float iceDensity = clamp(density, 0.12, 1.0);
  float aggregateBoost = mix(1.40, 1.10, iceDensity);
  float iceRadarSize = iceSize * mix(0.42, 0.60, iceDensity) * aggregateBoost;
  float iceCoeff = mix(0.32, 0.14, snowiness); // hail/graupel > snow, but snow should still echo aloft
  float iceMoment = iceCoeff * pow(max(iceRadarSize, 1e-4), 6.0);

  float brightBand = 0.0;
  if (liquid > 1e-6 && ice > 1e-6) {
    float onset = smoothstep(0.06, 0.22, liquidFraction);
    float fade = 1.0 - smoothstep(0.45, 0.72, liquidFraction);
    brightBand = onset * fade * mix(0.04, 0.09, 1.0 - snowiness);
  }

  float baseMoment = radarPresence * (waterMoment + iceMoment);
  float zh = baseMoment * (1.0 + brightBand + flattening * 0.04);
  float zv = radarPresence * (waterMoment * max(1.0 - flattening * 0.55, 0.60) + iceMoment * max(1.0 - flattening * 0.10, 0.90));
  zv *= (1.0 + brightBand * 0.65);
  float hv = sqrt(max(zh * zv, 0.0));
  float logRatio = log(max(zh, 1e-8) / max(zv, 1e-8));

  phaseOut0 = vec4(liquid, ice, 0.0, 0.0);
  phaseOut1 = vec4(logRatio, logRatio * logRatio, 0.0, 0.0);
  radarOut = vec4(zh, zv, hv, 1.0);
}
