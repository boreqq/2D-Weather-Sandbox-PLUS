#version 300 es
precision highp float;
precision highp int;

in vec2 position_out;
in vec2 mass_out;
in float density_out;
in float size_out;
in float compactness_out;

uniform int precipDisplayMode; // 0 default droplet overlay, 1 particle-size view

out vec4 fragmentColor;

// Precipitation mass:
#define WATER 0
#define ICE 1

vec3 sizeColor(float particleSize)
{
  const int n = 9;
  float levels[n] = float[n](0.0, 0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 30.0, 50.0);
  vec3 cols[n] = vec3[n](
    vec3(0, 38, 140) / 255.0,
    vec3(65, 190, 255) / 255.0,
    vec3(0, 220, 210) / 255.0,
    vec3(70, 220, 80) / 255.0,
    vec3(255, 235, 50) / 255.0,
    vec3(255, 150, 35) / 255.0,
    vec3(255, 45, 35) / 255.0,
    vec3(255, 75, 180) / 255.0,
    vec3(255, 255, 255) / 255.0
  );

  particleSize = clamp(particleSize, levels[0], levels[n - 1]);
  for (int i = 1; i < n; i++) {
    if (particleSize <= levels[i]) {
      float t = (particleSize - levels[i - 1]) / (levels[i] - levels[i - 1]);
      return mix(cols[i - 1], cols[i], t);
    }
  }
  return cols[n - 1];
}

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
  if (mass_out[WATER] < 0.)
    discard;

  vec2 spriteUV = gl_PointCoord * 2.0 - 1.0;
  float squareMask = 1.0;

  if (precipDisplayMode == 1) {
    float displaySize = max(size_out, 0.0);
    float visibleMetric = displaySize;
    float opacity = mix(0.45, 0.98, smoothstep(0.10, 8.00, visibleMetric));
    fragmentColor = vec4(sizeColor(displaySize), opacity * squareMask);
    return;
  }

  vec4 primary;
  vec2 secondary;
  hydrometeorMemberships(max(mass_out[WATER], 0.0), max(mass_out[ICE], 0.0), density_out, max(size_out, 0.0), compactness_out, primary, secondary);

  float displaySize = max(size_out, 0.0);
  float rainDisplayFlatten = smoothstep(1.0, 6.0, displaySize) * 0.56;
  float mixedDisplayFlatten = smoothstep(2.0, 8.0, displaySize) * 0.28;
  float snowDisplayFlatten = smoothstep(3.0, 12.0, displaySize) * 0.08;
  float displayFlattening = rainDisplayFlatten * primary.r +
                            mixedDisplayFlatten * (secondary.g * 0.70 + secondary.r * 0.32) +
                            snowDisplayFlatten * (primary.g * 0.60 + primary.b * 0.35);
  displayFlattening = clamp(displayFlattening, 0.0, 0.58);

  vec2 shapeUV = spriteUV;
  shapeUV.x /= 1.0 + displayFlattening * 0.68;
  shapeUV.y /= max(1.0 - displayFlattening * 0.82, 0.50);

  float r2 = dot(shapeUV, shapeUV);
  if (r2 > 1.0)
    discard;
  float spriteMask = 1.0 - smoothstep(0.35, 1.0, r2);

  float opacity = (mass_out[WATER] + mass_out[ICE]) * 0.10;
  opacity *= spriteMask;

  vec3 rainColor = vec3(0.0, 0.5, 1.0);
  vec3 snowColor = vec3(1.0);
  vec3 graupelColor = vec3(0.92, 0.86, 0.62);
  vec3 hailColor = vec3(1.0, 0.96, 0.10);
  vec3 wetHailColor = vec3(1.0, 0.58, 0.12);
  vec3 meltingColor = vec3(0.5, 1.0, 1.0);
  vec3 hydrometeorColor = rainColor * primary.r +
                          snowColor * primary.g +
                          graupelColor * primary.b +
                          hailColor * primary.a +
                          wetHailColor * secondary.r +
                          meltingColor * secondary.g;

  fragmentColor = vec4(hydrometeorColor, opacity);
}
