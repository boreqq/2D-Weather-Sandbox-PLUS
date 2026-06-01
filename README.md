# 2D Weather Sandbox PLUS
#### What it is?
This projects aims to produce a semirealistic two-dimensional, realtime, interactive simulation of the weather in earth's troposphere.

Simulating clouds and precipitation are the main objectives of this project. All the equations relating to water phase change are simplified versions of the real ones, to improve performance and ease programming. Precipitation is simulated using discrete particles but can be viualized as both partiles and smooth realistic looking curtains.

# Features

Features added in this version of 2DWS:

- ### Radars
  - The radar system in 2D Weather Sandbox PLUS simulates how real weather radars scan the atmosphere from a fixed tower location. In the simulation, radar beams are sent outward and return information about the particles in the air, such as drops, snow, hail and mixed-phase hydrometeors. The simulated radar tower acts like a real radar station: it collects data on the distance, height and properties of hydrometeors, then translates that information into common radar products.

  - The tower displays data from the 2D vertical cross-section (in expection to VIL, VILD and EHT. Those are displayed in entire column from ground to top of simulation)

  - You can place radar towers by selecting them in tool menu and placing them with left mouse button. By clicking them once again you open menu, where you can change parameters of radar tower, such as: resolution (size of one radar bin), beam width (width resolution), attenuation factor, refresh rate and range of the radar. You can also select 3 types of radars bands: X - high resolution, but high attenuation and short range; C - balance between resolution, range and atenuation; S - offers high range and low influence of attenuation, but very low resolution.

  - You can name radar towers up to 4 characters. You can select individual radar sites in radar menu. You can open it clicking in top left corner. In the menu you can select radar products (in composite mode you can only select reflectivity, POSH, MEHS and EHT). When you dont have any radar or every radar on the map has disabled view in composite, when composite selected, you can select every product (except KDP and Radial velocity), with entire map coverage, and with set refresh rate and resolution.
  Composite mode (when there is atleast one radar that is active in composite view on the map) shows data from all radars at once. It guarantees that you dont have to switch to every radar, when you want to see data from all the map.

  - Single site radar view shows polar grid map (with beam width and bin size), when composite shows data from all radars in one pixel grid map.

  - Products:
    - **Reflectivity** - radar product that shows size of particles in air. Its unit is dBZ, and it uses a logarithmic scale. Small precipitation, for example small raindrops from nimbostratus or small ice crystals, gives low dBZ values, usually 15–30 dBZ. Precipitation from a storm cell typically ranges from 30–55 dBZ. Hail mixed with heavy rain often gives 55+ dBZ. 2DWS PLUS simulates reflectivity with size, horizontal, vertical and ice/water attenuation.

    - **RhoHV (Correlation coefficient)** - radar product that shows correlation between the size and shape of particles in the scanned radar bin. Values near 1.0 indicate that particles are similar, for example ice or light rain. Lower values indicate differences between particles, for example hail and rain mixture, graupel, or non-meteorological particles.

    - **ZDR (Differential reflectivity)** - radar product that shows the difference between reflectivity in horizontal and vertical polarization. Values around 0 dBZ mean that particles have similar height and width, while higher values mean that particles are wider than taller. Big raindrops give high values, while hail and ice crystals usually give values around 0 dBZ or lower.

    - **KDP (Specific differential phase) [W.I.P.]** - polarimetric radar parameter that measures the difference in phase shift between horizontal and vertical radio waves. It provides a direct indicator of rain intensity, especially in heavy precipitation. It is calculated as the gradient of the total differential phase, PhiDP, along the beam, specifically targeting the amount of slowing caused by flattened, water-coated hydrometeors.

    - **Radial Velocity [W.I.P.]** - radar product that shows particles moving toward or away from the radar. It can show, for example, microbursts, downbursts, or rotation inside the cloud. Due to the simulation being in 2D, it cannot simulate mesocyclone rotations, but it can show horizontal vortices inside clouds.

    - **VIL (Vertically Integrated Liquid) [W.I.P.]** - radar-derived product that estimates the total amount of liquid water contained in a vertical column of the atmosphere. Its unit is usually kg/m².

      VIL is useful for detecting areas with strong precipitation cores. Higher VIL values usually indicate heavier rain, strong convective cells, or possible hail-producing regions. Low VIL values are typical for weak stratiform precipitation or shallow clouds.

      In 2DWS PLUS, VIL is visualized as full-height vertical columns in the 2D vertical cross-section. Each horizontal position has one VIL value, and this value is rendered from the top of the simulation area down to the ground. This means VIL does not show the exact vertical position of water inside the cloud, but instead shows the total liquid content of the whole atmospheric column.

    - **VILD (Vertically Integrated Liquid Density) [W.I.P.]** - radar-derived product based on VIL divided by the height of the radar echo. It estimates how concentrated the liquid water content is inside the vertical storm column. Its unit is usually g/m³.

      VILD is useful for distinguishing between tall clouds with broadly distributed precipitation and more compact, intense precipitation cores. Higher VILD values may indicate dense convective cores, heavy precipitation, or possible hail-producing regions. Compared to VIL alone, VILD can be more useful when comparing storms with different echo top heights.

      In 2DWS PLUS, VILD is calculated from the simulated VIL value and the height of the detected echo at each horizontal position. Like VIL, it is visualized as full-height vertical columns in the 2D vertical cross-section. This means VILD does not show where the dense precipitation is located vertically, but instead shows the density value assigned to the whole atmospheric column.

    - **EHT (Echo Top Height) [W.I.P.]** - radar-derived product that estimates the maximum height at which radar-detectable precipitation particles are present. It shows how high the radar echo extends above the ground.

      Echo Top Height is useful for identifying the vertical development of clouds and storms. Low echo tops usually indicate shallow precipitation or weak cloud growth, while high echo tops are often associated with deep convection, thunderstorms, strong updrafts, and intense storm cells.

      In 2DWS PLUS, EHT is displayed as full-height vertical columns in the 2D vertical cross-section. Each horizontal position has one echo top height value assigned to it, and the whole column from the top of the display to the bottom is colored according to that value. This means EHT does not show the complete shape of the cloud top, but shows the maximum detected radar echo height for each horizontal position.
  - Attenuation - when radar signal passes through particles in the air, its getting scattered. Because of that, when radar beam tries to scan whats behind high precipitation area, signal has lowered strength, so readings will be lowered that its actually. You can fix this by using S-band radar, or by placing many radar sites and using composite view.

**MORE INFORMATIONS IN README SOON!**