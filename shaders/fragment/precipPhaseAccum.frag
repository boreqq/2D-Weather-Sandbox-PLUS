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

  float reflectivityWeight = 1.0;
  if (ice > 0.0) {
    if (liquid > 1e-6) {
      reflectivityWeight = mix(0.65, 0.95, liquidFraction);
    } else {
      reflectivityWeight = mix(0.55, 0.10, snowiness);
    }
  }

  float flattening = 0.0;
  if (liquidFraction > 0.7) {
    flattening = clamp((size - 0.45) * 0.35, 0.0, 0.22);
  } else if (liquid > 0.0 && ice > 0.0) {
    flattening = clamp((size - 0.50) * 0.18, 0.0, 0.10);
  } else if (iceFraction > 0.99 && density < 0.95) {
    flattening = clamp((size - 0.60) * 0.08, 0.0, 0.04);
  }

  // Super-particles represent packets of hydrometeors, not single drops, so the
  // raw size proxy must be damped before using a D^6-style radar moment.
  float effectiveSize = size * 0.45;
  if (ice > 0.0) {
    if (liquid > 1e-6) {
      effectiveSize *= mix(0.85, 1.00, liquidFraction);
    } else {
      effectiveSize *= mix(0.75, 0.45, snowiness);
    }
  }

  // Suppress fresh/tiny particles so reflectivity does not instantly appear
  // everywhere new particles spawn inside cloud.
  float radarPresence = smoothstep(0.18, 0.45, total);

  float baseMoment = radarPresence * reflectivityWeight * pow(max(effectiveSize, 1e-4), 6.0);
  float zh = baseMoment * (1.0 + flattening);
  float zv = baseMoment * max(1.0 - flattening * 0.75, 0.35);
  float kdp = baseMoment * liquidFraction * flattening * 0.03;

  phaseOut0 = vec4(liquid, ice, 0.0, 0.0);
  phaseOut1 = vec4(density, density * density, 1.0, 0.0);
  radarOut = vec4(zh, zv, kdp, 1.0);
}
