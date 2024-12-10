# Black Pixel Analyzer

## Overview

Black Pixel Analyzer is a Python application designed to analyze and optimize images for AMOLED screens by calculating black pixel percentages and blackifying pixels below a specified threshold. This tool is particularly useful for enhancing the visual quality of images on AMOLED devices, which benefit from deeper black levels and reduced burn-in.

## Features

- Calculate black pixel percentage
- Interactive pixel conversion with real-time preview
- Adjustable threshold slider
- Save processed images

## Prerequisites

- Python 3.7+
- Required libraries: numpy, pillow (see requirements.txt)

## Installation

1. Clone the repository

  ```bash
  git clone https://github.com/Neel-XV/black-pixel-analyzer.git
  cd black-pixel-analyzer
  ```

2. Install dependencies:

  ```bash
  pip install -r requirements.txt
  ```

## Usage

Run the application:

```bash
python black_pixel_converter.py
```

### Options

1. **Calculate Black Pixel Percentage**
2. **Blackify Pixels**

  - Interactive slider to adjust threshold
  - Real-time image preview
  - Save processed image

## Dependencies

- NumPy: Numerical computing
- Pillow: Image processing
- Tkinter: GUI development

## Contributing

Contributions welcome! Submit Pull Requests.

## License

[MIT License](./LICENSE)
