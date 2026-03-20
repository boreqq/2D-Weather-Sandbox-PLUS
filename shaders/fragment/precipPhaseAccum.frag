#version 300 es
precision highp float;

in vec4 data_out; // liquid, ice, density, size
layout(location = 0) out vec4 phaseOut0; // R liquid sum, G ice sum, B -, A -
layout(location = 1) out vec4 phaseOut1; // R densSum, G densSumSq, B count, A -
layout(location = 2) out vec4 radarOut;  // R Zh proxy, G Zv proxy, B KDP proxy, A count

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
  // everywhere new particles spawn inside cloud.
  float radarPresence = smoothstep(0.18, 0.45, total);

  // Split the packet into separate liquid/ice radar contributors.
  // Water has a much stronger dielectric response than dry ice, while mixed-phase
  // should only create a modest bright band instead of a detached strong stripe.
  float waterSize = size * pow(max(liquidFraction, 0.0), 1.0 / 3.0);
  float iceSize = size * pow(max(iceFraction, 0.0), 1.0 / 3.0);

  // Keep rain stronger than dry ice/snow. Low-density ice still has a large
  // geometric size proxy, so it needs an extra density-based damping before
  // entering a D^6-style moment.
  float waterMoment = pow(max(waterSize * 0.58, 1e-4), 6.0);
  float iceRadarSize = iceSize * mix(0.22, 0.34, clamp(density, 0.12, 1.0));
  float iceCoeff = mix(0.18, 0.04, snowiness); // hail/graupel > snow, all well below liquid water
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
  float kdp = radarPresence * waterMoment * liquidFraction * flattening * 0.05;

  phaseOut0 = vec4(liquid, ice, 0.0, 0.0);
  phaseOut1 = vec4(density, density * density, 1.0, 0.0);
  radarOut = vec4(zh, zv, kdp, 1.0);
}
