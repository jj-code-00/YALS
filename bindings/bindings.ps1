if (Get-Command cmake -ErrorAction SilentlyContinue) {
    Write-Host "Found CMake: $(cmake --version)"
} else {
    Import-Module 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
    Enter-VsDevShell -VsInstallPath 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools' -DevCmdArguments '-arch=x64 -host_arch=x64'
}

$jobs = if ($env:MAX_JOBS) {
    $env:MAX_JOBS
} else {
    $env:NUMBER_OF_PROCESSORS
}

$extraCmakeArgs = @()

# llama.cpp dev options
if ($env:LLAMACPP_REPO) {
    $extraCmakeArgs += "-DLLAMACPP_REPO=$env:LLAMACPP_REPO"
    Write-Host "Using custom llama.cpp repo: $env:LLAMACPP_REPO"
}

if ($env:LLAMACPP_COMMIT) {
    $extraCmakeArgs += "-DLLAMACPP_COMMIT=$env:LLAMACPP_COMMIT"
    Write-Host "Using custom llama.cpp commit: $env:LLAMACPP_COMMIT"
}

if ($env:GGML_CUDA -eq 1) {
    Write-Host "CUDA enabled, including in build"

    $extraCmakeArgs += "-DGGML_CUDA=ON"

    if ($env:CMAKE_CUDA_ARCHITECTURES) {
        $extraCmakeArgs += @(
            "-DCMAKE_CUDA_ARCHITECTURES=$env:CMAKE_CUDA_ARCHITECTURES",
            "-DGGML_NATIVE=OFF"
        )
    }
}

if ($env:GGML_VULKAN -eq 1) {
    Write-Host "Vulkan enabled, including in build"

    $extraCmakeArgs += "-DGGML_VULKAN=ON"
}

if ($env:GGML_HIP -eq 1) {
    Write-Host "HIP enabled, including in build"

    $extraCmakeArgs += "-DGGML_HIP=ON"

    if ($env:AMDGPU_TARGETS) {
        $extraCmakeArgs += @(
            "-DAMDGPU_TARGETS=gfx$env:AMDGPU_TARGETS"
        )
    }

    if ($env:ROCM_CLANG) {
        $extraCmakeArgs += "-DCMAKE_C_COMPILER=$env:ROCM_CLANG"
    }

    if ($env:ROCM_CLANGXX) {
        $extraCmakeArgs += "-DCMAKE_CXX_COMPILER=$env:ROCM_CLANGXX"
    }

}

cmake . -B build -G "Ninja" -DCMAKE_BUILD_TYPE=Release $extraCmakeArgs
cmake --build build --config Release --target deno_cpp_binding -j $jobs
Copy-Item build/*.dll ../lib
Copy-Item build/bin/*.dll ../lib
