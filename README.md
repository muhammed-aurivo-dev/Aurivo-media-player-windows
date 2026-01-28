# Aurivo Medya Player

Qt 6 + C++ ile minimal başlangıç.

## Build / Run

```bash
# repo kökünde
./aurivo
```

Alternatif manuel:

```bash
cmake -S . -B build
cmake --build build -j
./build/aurivo
```

## Visualizer (projectM) Build (Linux)

`aurivo-projectm-visualizer` çıktısını `native-dist/` altına kopyalar.

Not: `third_party/projectm/vendor/projectm-eval` klasörü boşsa, repo submodule’larını çekmeniz gerekebilir:
`git submodule update --init --recursive`

```bash
mkdir -p build-visualizer
cmake -S visualizer -B build-visualizer -G Ninja
cmake --build build-visualizer
cp build-visualizer/aurivo-projectm-visualizer native-dist/aurivo-projectm-visualizer
chmod +x native-dist/aurivo-projectm-visualizer
```
