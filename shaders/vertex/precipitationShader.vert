#version 300 es
precision highp float;


layout(location = 0) in vec2 dropPosition;
layout(location = 1) in vec2 mass; //[0] water   [1] ice
layout(location = 2) in float density;
layout(location = 3) in float size;
layout(location = 4) in float compactness;

// transform feedback varyings:
out vec2 position_out;
out vec2 mass_out;
out float density_out;
out float size_out;
out float compactness_out;

// via fragmentshader to feedback framebuffers for feedback to fluid
out vec4 feedback;
out vec2 deposition; // for rain and snow accumulation on surface

vec2 texCoord;
vec4 water;
vec4 base;
float realTemp;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform sampler2D lightningDataTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;

uniform float iterNum;          // used as seed for random function
uniform float numDroplets;      // total number of droplets
uniform float inactiveDroplets; // used to maintain constant spawnrate

uniform float evapHeat;
uniform float meltingHeat;

// prcipitation settings:
uniform float aboveZeroThreshold; // 1.0
uniform float subZeroThreshold;   // 0.0
uniform float spawnChanceMult;    //
uniform float snowDensity;        // 0.2 - 0.5
uniform float fallSpeed;          // 0.0003
uniform float growthRate0C;       // 0.0005
uniform float growthRate_30C;     // 0.01
uniform float freezingRate;       // 0.0002
uniform float meltingRate;        // 0.0015
uniform float evapRate;           // 0.0005

#include "common.glsl"

vec2 newPos;
vec2 newMass;
float newDensity;
float newSize;
float newCompactness;

bool isActive = true;
bool spawned = false; // spawned in this iteration
bool lightningSpawned = false;

void disableDroplet()
{
  newMass[WATER] = -2. - dropPosition.x; // disable droplet by making it negative and save position as seed for respawning
  newMass[ICE] = dropPosition.y;         // save position as seed for random function when respawning later
  newSize = 0.0;
  newCompactness = 0.0;
}

const float hydrometeorDiameterMmPerMassCubeRoot = 1.0;

float calcHydrometeorSize(vec2 hydromass, float hydrodensity, float hydroCompactness)
{
  float liquid = max(hydromass[WATER], 0.0);
  float ice = max(hydromass[ICE], 0.0);
  float totalMass = liquid + ice;
  if (totalMass <= 0.0)
    return 0.0;

  float iceFraction = ice / max(totalMass, 1e-6);
  float liquidFraction = liquid / max(totalMass, 1e-6);
  float clampedDensity = clamp(hydrodensity, 0.12, 1.0);
  float clampedCompactness = clamp(hydroCompactness, 0.0, 1.0);

  // Size is stored as particle diameter in millimeters.
  float structureDensity = mix(0.30, 0.95,
    smoothstep(0.25, 0.95, clampedDensity) *
    smoothstep(0.20, 0.80, clampedCompactness)
  );
  float effectiveDensity = clamp(mix(structureDensity, 1.0, liquidFraction), 0.30, 1.0);
  float volumeProxy = totalMass / effectiveDensity;
  float waterEquivalentDiameterMm = pow(volumeProxy, 1.0 / 3.0) * hydrometeorDiameterMmPerMassCubeRoot;

  float snowiness = clamp((0.72 - clampedDensity) / 0.42, 0.0, 1.0) * (1.0 - smoothstep(0.28, 0.72, clampedCompactness));
  float compactHailness = smoothstep(0.72, 0.98, clampedCompactness) * smoothstep(0.55, 0.95, iceFraction);
  float denseRimedHailness = smoothstep(0.84, 1.0, clampedDensity) *
                             smoothstep(1.6, 2.2, waterEquivalentDiameterMm) *
                             smoothstep(0.42, 0.55, clampedCompactness) *
                             smoothstep(0.70, 0.96, iceFraction);
  float hailness = max(compactHailness, denseRimedHailness);
  float graupelness = smoothstep(0.28, 0.68, clampedCompactness) * (1.0 - hailness) * smoothstep(0.45, 0.95, iceFraction);

  // Ordinary snow should stay relatively small, aggregates only modestly larger,
  // while dense ice / hail can exceed rain size.
  float drySnowScale = mix(0.88, 1.10, snowiness);
  float graupelScale = mix(drySnowScale, 1.14, graupelness);
  float hailScale = 1.00 + hailness * hailness * 5.50;
  float iceScale = mix(graupelScale, hailScale, hailness);

  // Keep the melting layer transition gentle so particles do not collapse in size
  // the moment they start melting.
  float mixedScale = mix(iceScale, max(1.00, 1.05 + hailness * 0.10), smoothstep(0.18, 0.88, liquidFraction));

  if (ice <= 1e-6)
    return waterEquivalentDiameterMm;
  if (liquid <= 1e-6)
    return waterEquivalentDiameterMm * iceScale;
  return waterEquivalentDiameterMm * mixedScale;
}

void main()
{
  newPos = dropPosition;
  newMass = mass;         // amount of water and ice carried
  newDensity = density;   // determines fall speed
  newSize = size;         // hydrometeor diameter in mm
  newCompactness = compactness; // remembers how rimed / compact the ice core is

  if (mass[WATER] < 0.) { // inactive
                          /*
                          We have to generate a random position before we know if the droplet is actually gonna spawn, seems ineffcient but there is no way arround it.
                          This is because spawn chance depends on the conditions at the spawn position, we have to sample the textures for every inactive droplet. this is a huge performance bottleneck
                       */

                          // generate random spawn position: x and y from 0. to 1.
    // texCoord = vec2(random(mass[WATER] + iterNum), random(mass[ICE] + iterNum)); func2D
    // texCoord = vec2(func2D(vec2(mass[WATER], dropPosition.x), iterNum * 0.3754), func2D(vec2(mass[ICE], dropPosition.x), iterNum * 0.073162));

    texCoord = vec2(random2d(vec2(mass[WATER], dropPosition.x + iterNum * 0.3754)), random2d(vec2(mass[ICE], dropPosition.x + iterNum * 0.073162)));


    // sample fluid at generated position
    base = texture(baseTex, texCoord);
    water = texture(waterTex, texCoord);

    // check if position is okay to spawn
    realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin

#define initalMass 0.15                             // 0.05 initial droplet mass
    float threshold;                                // minimal cloudwater before precipitation develops
    if (realTemp > CtoK(0.0))
      threshold = aboveZeroThreshold;               // in above freezing conditions coalescence only happens in really dense clouds
    else                                            // the colder it gets, the faster ice starts to form
      //  treshHold = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), subZeroThreshold, initalMass), initalMass);
      threshold = subZeroThreshold;

    if (water[CLOUD] > threshold && base[TEMPERATURE] < 500.) {                                                                     // if cloudwater above threshold and not wall
                                                                                                                                    // float spawnChance = (water[1] - threshold) * 1000.0 / inactiveDroplets;
                                                                                                                                    // if (spawnChance > rand2d(mass.xy)) {
                                                                                                                                    //  float spawnChance = (water[CLOUD] - threshold) / inactiveDroplets * resolution.x * resolution.y * spawnChanceMult;

      float spawnChance = ((water[CLOUD] - threshold) / (inactiveDroplets + 10.0)) * resolution.x * resolution.y * spawnChanceMult; // 20.0  50.0

      //    float nrmRand = random2d(vec2(mass[WATER] * 0.2324, iterNum * 0.1783 + random(mass[ICE]))); // normalized random value

      float nrmRand = fract(pow(water[CLOUD] * 10.0, 2.0));

      if (spawnChance > nrmRand) {                                       // spawn precipitation particle
        spawned = true;
        newPos = vec2((texCoord.x - 0.5) * 2., (texCoord.y - 0.5) * 2.); // convert texture coordinate (0 to 1) to position (-1 to 1)

        if (realTemp < CtoK(0.0)) {                                      // below 0 C
          newMass[WATER] = 0.0;                                          // enable
          newMass[ICE] = initalMass;                                     // snow
          feedback[HEAT] += newMass[ICE] * meltingHeat;                  // add heat of freezing
          newDensity = snowDensity;
          newCompactness = 0.12;
          newSize = calcHydrometeorSize(newMass, newDensity, newCompactness);

          vec4 lightningData = texture(lightningDataTex, vec2(0.5)); // data from last lightning bolt

          const float lightningCloudDensityThreshold = 2.5;          // 3.0
          const float lightningChanceMultiplier = 0.0033;            // 0.0011

          float cloudPlusPrecipDensity = water[CLOUD] + water[PRECIPITATION];

          float lightningSpawnChance = max((cloudPlusPrecipDensity - lightningCloudDensityThreshold) * lightningChanceMultiplier, 0.);

          const float minIterationsSinceLastLightningBolt = 30.;                                                                                                                       // 50.

          if (lightningData[START_ITERNUM] < iterNum - minIterationsSinceLastLightningBolt && random2d(vec2(base[TEMPERATURE] * 0.2324, water[TOTAL] * 7.7)) < lightningSpawnChance) { // Spawn lightning
            lightningSpawned = true;
            isActive = false;
            gl_PointSize = 1.0;
            feedback.xy = texCoord;
            feedback[START_ITERNUM] = iterNum;
            feedback[INTENSITY] = clamp(cloudPlusPrecipDensity / 10.0 + (random2d(texCoord) - 0.5), 0.01, 4.0);
            gl_Position = vec4(vec2(-1. + texelSize.x * 3., -1. + texelSize.y), 0.0, 1.0); // render to bottem left corner (1, 0)
          }
        } else {
          newMass[WATER] = initalMass; // rain
          newMass[ICE] = 0.0;
          newDensity = 1.0;
          newCompactness = 1.0;
          newSize = calcHydrometeorSize(newMass, newDensity, newCompactness);
        }
        feedback[VAPOR] -= initalMass;
      }
    }

    if (spawned) {
      if (!lightningSpawned) {
        gl_PointSize = 1.0;
        gl_Position = vec4(newPos, 0.0, 1.0);
      }
    } else { // still inactive
      isActive = false;
      gl_PointSize = 1.0;
      feedback[MASS] = 1.0;                                                     // count 1 inactive droplet
      gl_Position = vec4(vec2(-1. + texelSize.x, -1. + texelSize.y), 0.0, 1.0); // render to bottem left corner (0, 0) to count inactive droplets
                                                                                // return;
    }
  }

  if (isActive) {
    if (!spawned) {                               // these values are already set if the droplet just spawned
      texCoord = vec2(dropPosition.x / 2. + 0.5,
                      dropPosition.y / 2. + 0.5); // convert position (-1 to 1) to texture coordinate (0 to 1)
      water = texture(waterTex, texCoord);
      base = texture(baseTex, texCoord);
      realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin
    }

    float totalMass = newMass[WATER] + newMass[ICE];

    if (totalMass < 0.04) { // to small
                            // evaporation of residual droplet
      feedback[HEAT] = -(totalMass * evapHeat);
      feedback[VAPOR] = totalMass;

      disableDroplet();

    } else if (newPos.y < -1.0 /* || base[TEMPERATURE] > 500. */ || water[TOTAL] > 1000.) { // water[TOTAL] > 1000.     base[TEMPERATURE] < 500.      to low or wall

      if (texture(baseTex, vec2(texCoord.x, texCoord.y + texelSize.y))[TEMPERATURE] > 500.) // if above cell was already wall. because of fast fall speed
        newPos.y += texelSize.y * 1.;                                                       // *2. ? move position up so that the water/snow is correcty added to the ground

      deposition[RAIN_DEPOSITION] = newMass[WATER];                                         // rain accumulation
      deposition[SNOW_DEPOSITION] = newMass[ICE];                                           // snow accumulation

      disableDroplet();

    } else { // update droplet

      // float surfaceArea = sqrt(totalMass); // As if droplet is a circle (2D)
      float surfaceArea = pow(totalMass, 1. / 3.); // As if droplet is a sphere (3D)

                                                   // float growthRate = clamp(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C, growthRate_30C); // the colder it gets the faster ice forms
      float growthRate = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C); // the colder it gets the faster ice forms

      // growthRate = 0.0;                                                                                                                  // for debug

      float growth = water[CLOUD] * growthRate * surfaceArea;

      float hailAccretion = 0.0;
      float hailRiming = 0.0;
      float freezing = 0.0;
      float melting = 0.0;

      // Hail growth enhancement: limited riming from supercooled cloud water.
      if (realTemp < CtoK(0.0) && newMass[ICE] > 0.0) {
        float cloudExcess = max(water[CLOUD] - 0.75, 0.0);
        float updraftFactor = smoothstep(0.015, 0.12, base[VY]);
        float hailTempFactor = (1.0 - smoothstep(CtoK(-6.0), CtoK(0.0), realTemp)) *
                               smoothstep(CtoK(-45.0), CtoK(-30.0), realTemp);
        float rimingSeed = smoothstep(0.08, 0.45, newMass[ICE]) *
                           smoothstep(1.5, 4.5, max(newSize, 0.0));
        hailRiming = cloudExcess * updraftFactor * hailTempFactor * rimingSeed;

        float hailCandidate = rimingSeed *
                              smoothstep(0.35, 0.75, newDensity) *
                              smoothstep(3.0, 6.0, max(newSize, 0.0));

        float richCloudBoost = smoothstep(1.0, 4.0, cloudExcess);
        float collectionBoost = mix(1.0, 2.2, richCloudBoost);
        hailAccretion = cloudExcess * surfaceArea * 0.0025 * collectionBoost * updraftFactor * hailTempFactor * hailCandidate;
        hailAccretion = min(hailAccretion, totalMass * mix(0.025, 0.045, richCloudBoost));
        hailAccretion = min(hailAccretion, cloudExcess * mix(0.035, 0.060, richCloudBoost));
        float densityRimingRate = clamp(hailRiming * 0.004 + hailAccretion / max(totalMass, 1e-6) * 0.35, 0.0, 0.018);
        newDensity = mix(newDensity, 0.92, densityRimingRate);
        growth += hailAccretion;
      }

      feedback[VAPOR] -= growth * 1.0; // takes water from the air


      if (realTemp < CtoK(0.0)) { // below freezing

        newMass[ICE] += growth;   // ice growth
        feedback[HEAT] += growth * meltingHeat;

        freezing = min((CtoK(0.0) - realTemp) * freezingRate * surfaceArea, newMass[WATER]); // rain freezing
        newMass[WATER] -= freezing;
        newMass[ICE] += freezing;
        feedback[HEAT] += freezing * meltingHeat;

      } else {                                                                                                    // above freezing
        newMass[WATER] += growth;                                                                                 // water growth

        float preMeltTotalMass = max(newMass[WATER] + newMass[ICE], 1e-6);
        float preMeltLiquidFraction = newMass[WATER] / preMeltTotalMass;
        float preMeltIceFraction = newMass[ICE] / preMeltTotalMass;
        float hailMeltCore = smoothstep(0.78, 1.00, newDensity) *
                             smoothstep(0.50, 0.88, newCompactness) *
                             smoothstep(8.0, 24.0, max(newSize, 0.0)) *
                             smoothstep(0.45, 0.95, preMeltIceFraction);
        float wetShellVentilation = smoothstep(0.08, 0.45, preMeltLiquidFraction);
        float hailMeltingFactor = mix(1.0, mix(0.34, 0.48, wetShellVentilation), hailMeltCore);
        melting = min((realTemp - CtoK(0.0)) * meltingRate * surfaceArea * hailMeltingFactor /* / newDensity */, newMass[ICE]); // 0.0002 snow / hail melting
        newMass[ICE] -= melting;
        newMass[WATER] += melting;
        feedback[HEAT] -= melting * meltingHeat;

        newDensity = min(newDensity + (melting / totalMass) * 1.00,
                         1.0); // density increases upto 1.0 as snow melts
      }

      float dropletTemp = potentialToRealT(base[TEMPERATURE]);                                       // should be wetbulb temperature...

      if (newMass[ICE] > 0.0)                                                                        // if any ice
        dropletTemp = min(dropletTemp, CtoK(0.0));                                                   // temp can not be more than 0 C

      float evapAndSubli = max((maxWater(dropletTemp) - water[TOTAL]) * surfaceArea * evapRate, 0.); // 0.0005 evaporation and sublimation only positive

      // evapAndSubli = 0.0000;                                                                         // remove quickly for DEBUG

      float evap = min(newMass[WATER], evapAndSubli);       // can only evaporate as much water as it contains
      float subli = min(newMass[ICE], evapAndSubli - evap); // the rest is ice sublimation, upto the amount of ice it contains

      newMass[WATER] -= evap;                               // water evaporation
      newMass[ICE] -= subli;                                // ice sublimation

      feedback[VAPOR] += evap;                              // added to water vapor in air
      feedback[VAPOR] += subli;
      feedback[HEAT] -= evap * evapHeat;                    // heat cost extracted from air
      feedback[HEAT] -= subli * evapHeat;
      feedback[HEAT] -= subli * meltingHeat;

      float totalMassPost = newMass[WATER] + newMass[ICE];
      float liquidFractionPost = newMass[WATER] / max(totalMassPost, 1e-6);

      if (newMass[ICE] > 1e-6) {
        if (realTemp < CtoK(0.0)) {
          float massNorm = max(totalMassPost, 1e-6);
          float growthNorm = growth / massNorm;
          float freezingNorm = freezing / massNorm;
          float hailNorm = hailAccretion / massNorm;
          float largeDenseIce = smoothstep(0.84, 1.0, newDensity) *
                                smoothstep(1.8, 2.8, max(newSize, 0.0)) *
                                smoothstep(0.70, 0.96, newMass[ICE] / max(totalMassPost, 1e-6)) *
                                (1.0 - smoothstep(0.10, 0.25, liquidFractionPost));
          float rimingSignal = max(clamp(hailRiming * 0.20, 0.0, 1.0), largeDenseIce * 0.75);
          float dryIceCore = smoothstep(0.90, 0.995, newMass[ICE] / max(totalMassPost, 1e-6)) *
                             (1.0 - smoothstep(0.02, 0.12, liquidFractionPost)) *
                             smoothstep(0.82, 1.00, newDensity);
          float hailCoreBoost = dryIceCore * smoothstep(5.0, 20.0, max(newSize, 0.0));
          float compactnessTarget = clamp(
            0.12 +
            smoothstep(0.45, 0.98, newDensity) * 0.38 +
            growthNorm * 0.15 +
            freezingNorm * 0.55 +
            rimingSignal * 0.30 +
            largeDenseIce * 0.26 +
            hailNorm * 1.30 +
            hailCoreBoost * 0.42,
            0.05, 1.0
          );
          float compactnessRate = clamp(0.04 + freezingNorm * 0.80 + rimingSignal * 0.12 + largeDenseIce * 0.06 + hailNorm * 1.15 + hailCoreBoost * 0.28, 0.0, 1.0);
          newCompactness = mix(newCompactness, compactnessTarget, compactnessRate);
          newCompactness = max(newCompactness, hailCoreBoost * mix(0.58, 0.92, hailCoreBoost));
          if (newMass[WATER] <= 1e-6 && newDensity < 0.55)
            newCompactness = mix(newCompactness, 0.12, 0.03);
        } else {
          float meltRetention = 1.0 - smoothstep(0.70, 1.00, liquidFractionPost) * 0.08;
          newCompactness = clamp(max(newCompactness * meltRetention, 0.05), 0.05, 1.0);
        }
      } else {
        newCompactness = 1.0;
      }

      float targetSize = calcHydrometeorSize(newMass, newDensity, newCompactness);
      float sizeAdjustRate = 0.20;
      if (newMass[WATER] > 1e-6 && newMass[ICE] > 1e-6)
        sizeAdjustRate = mix(0.18, 0.32, smoothstep(0.10, 0.75, liquidFractionPost));
      else if (newMass[WATER] > 1e-6)
        sizeAdjustRate = 0.28;
      else if (newMass[ICE] > 1e-6)
        sizeAdjustRate = 0.16;

      // Faster response when droplets are shrinking (evaporation / melting -> smaller diameter)
      if (targetSize < newSize)
        sizeAdjustRate = max(sizeAdjustRate, 0.60);

      if (newSize <= 0.0 || spawned)
        newSize = targetSize;
      else
        newSize = mix(newSize, targetSize, sizeAdjustRate);

      // Update position
      // move with air    * 2. because droplet position goes from -1. to 1
      newPos += base.xy / resolution * 2.;
      float fallMass = max(newMass[WATER] + newMass[ICE], 1e-6);
      float fallSurfaceArea = max(pow(fallMass, 1.0 / 3.0), 1e-6);
      float fallLiquidFraction = newMass[WATER] / fallMass;
      float fallIceFraction = newMass[ICE] / fallMass;
      float fallDiameter = max(newSize, 0.0);
      float fallCompactness = clamp(newCompactness, 0.0, 1.0);
      float fallDensity = clamp(newDensity, 0.0, 1.0);
      float denseEquivalentDiameter = pow(fallMass / max(fallDensity, 0.18), 1.0 / 3.0);
      float compactShape = smoothstep(0.30, 0.90, fallCompactness);
      float wetSurface = smoothstep(0.08, 0.65, fallLiquidFraction);
      float aerodynamicDiameter = mix(max(fallDiameter, 0.50), denseEquivalentDiameter, compactShape * smoothstep(0.42, 0.95, fallDensity));
      float massAreaFall = sqrt(fallMass / max(aerodynamicDiameter * aerodynamicDiameter, 0.25));
      float porousSnowDrag = fallIceFraction * (1.0 - wetSurface) *
                             (1.0 - smoothstep(0.42, 0.82, fallDensity)) *
                             (1.0 - smoothstep(0.22, 0.68, fallCompactness));
      float irregularIceDrag = fallIceFraction * (1.0 - wetSurface) *
                               smoothstep(0.28, 0.70, fallCompactness) *
                               (1.0 - smoothstep(0.72, 0.98, fallDensity));
      float dragShape = clamp(1.0 + porousSnowDrag * 1.45 + irregularIceDrag * 0.35 - compactShape * 0.18 - wetSurface * 0.10, 0.65, 2.60);
      float densityFall = mix(0.52, 1.28, smoothstep(0.18, 1.0, fallDensity));
      float sizeFall = mix(0.75, 1.38, smoothstep(0.8, 32.0, fallDiameter));
      float dryHailFall = smoothstep(0.82, 1.00, fallDensity) *
                          smoothstep(0.58, 0.90, fallCompactness) *
                          smoothstep(5.0, 16.0, fallDiameter) *
                          smoothstep(0.70, 0.98, fallIceFraction) *
                          (1.0 - smoothstep(0.04, 0.18, fallLiquidFraction));
      float wetHailFall = smoothstep(0.72, 1.00, fallDensity) *
                          smoothstep(0.48, 0.88, fallCompactness) *
                          smoothstep(4.0, 14.0, fallDiameter) *
                          smoothstep(0.45, 0.95, fallIceFraction) *
                          smoothstep(0.05, 0.45, fallLiquidFraction);
      float meltingHailFall = smoothstep(3.0, 12.0, fallDiameter) *
                              smoothstep(0.20, 0.90, fallIceFraction) *
                              smoothstep(0.08, 0.70, fallLiquidFraction) *
                              smoothstep(0.42, 0.82, fallCompactness);
      float legacyFallSpeed = fallSpeed * newDensity * sqrt(fallMass / fallSurfaceArea);
      float hailDrag = mix(1.0, 0.84, dryHailFall * smoothstep(10.0, 35.0, fallDiameter));
      float hailFallBoost = 1.0 + dryHailFall * 0.28 + wetHailFall * 0.42 + meltingHailFall * 0.36;
      float terminalFallSpeed = fallSpeed * massAreaFall * densityFall * sizeFall * hailDrag * hailFallBoost / dragShape;
      float terminalBlend = smoothstep(2.0, 12.0, fallDiameter) * smoothstep(0.35, 0.92, fallDensity);
      terminalBlend = max(terminalBlend, smoothstep(3.0, 10.0, fallDiameter) * max(wetHailFall * 0.72, meltingHailFall * 0.58));
      newPos.y -= mix(legacyFallSpeed, terminalFallSpeed, terminalBlend); // fall speed relative to air
      /*
       // falling at fixed speed:
      float cellHeight = texelSize.y * 12000.0; // in meters
      float realSecPerIter = 0.288;
      float metersPerSec = 6.0;
      float cellsPerSec = metersPerSec / cellHeight;
      float cellsPerIter = cellsPerSec * realSecPerIter;
      newPos.y -= cellsPerIter * 2. * texelSize.y;
      */

      newPos.x = mod(newPos.x + 1., 2.) - 1.; // wrap horizontal position around map edges

      feedback[MASS] = totalMass;

    }               // update

#define pntSize 12. // 16.
    const float pntSurface = pntSize * pntSize;
    // devide by suface area to keep total amount constant
    feedback[MASS] /= pntSurface;
    feedback[HEAT] /= pntSurface;
    feedback[VAPOR] /= pntSurface;

    deposition[RAIN_DEPOSITION] /= pntSize; // only width matters because it's only applied at surface layer
    deposition[SNOW_DEPOSITION] /= pntSize; // only width matters because it's only applied at surface layer

    gl_PointSize = pntSize;

    gl_Position = vec4(newPos, 0.0, 1.0);
  } // active

  position_out = newPos;
  mass_out = newMass;
  density_out = max(newDensity, 0.);
  size_out = max(newSize, 0.);
  compactness_out = clamp(newCompactness, 0.0, 1.0);
}
