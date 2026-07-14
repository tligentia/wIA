import os from 'os';
import { execSync } from 'child_process';

/**
 * Detects local system CPU specifications, AVX flags, and GPU architectures.
 * Runs 100% offline using standard node APIs and local CLI utilities.
 */
export async function detectHardware() {
  const info = {
    cpu: {
      model: 'Unknown',
      cores: os.cpus().length,
      threads: os.cpus().length,
      arch: os.arch(),
      avx: false,
      avx2: false,
      avx512: false
    },
    gpu: {
      type: 'CPU', // Default fallback
      vendor: 'Generic',
      model: 'System Graphic Adapter',
      cuda: false,
      rocm: false,
      metal: false,
      vram: 'Unknown'
    },
    acceleration: 'CPU'
  };

  // Populate CPU Model
  const cpus = os.cpus();
  if (cpus && cpus.length > 0) {
    info.cpu.model = cpus[0].model.trim();
  }

  const platform = os.platform();

  // 1. CPU Instruction Set Feature Detection (AVX, AVX2, AVX512)
  try {
    if (platform === 'darwin') {
      // macOS sysctl flags
      const sysctlOutput = execSync('sysctl -a', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      info.cpu.avx = sysctlOutput.includes('hw.optional.avx1_0: 1') || sysctlOutput.toLowerCase().includes('avx');
      info.cpu.avx2 = sysctlOutput.includes('hw.optional.avx2_0: 1') || sysctlOutput.toLowerCase().includes('avx2');
      info.cpu.avx512 = sysctlOutput.includes('hw.optional.avx512') || sysctlOutput.toLowerCase().includes('avx512');
    } else if (platform === 'linux') {
      // Linux cpuinfo flags
      const cpuinfo = execSync('cat /proc/cpuinfo', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      info.cpu.avx = cpuinfo.includes(' avx ');
      info.cpu.avx2 = cpuinfo.includes(' avx2 ');
      info.cpu.avx512 = cpuinfo.includes(' avx512') || cpuinfo.includes('avx512f');
    } else if (platform === 'win32') {
      // Windows Coreinfo or helper check (basic AVX verification)
      // Since native check on Windows is complex without extra binaries, check arch and CPU model strings
      const isModern = info.cpu.model.includes('Core') || info.cpu.model.includes('Ryzen') || info.cpu.model.includes('Xeon');
      info.cpu.avx = isModern;
      info.cpu.avx2 = isModern && !info.cpu.model.includes('3rd Gen') && !info.cpu.model.includes('2nd Gen');
    }
  } catch (e) {
    // Graceful degradation on permission or environment restrictions
  }

  // 2. GPU Detection
  try {
    if (platform === 'darwin') {
      // macOS Metal and Silicon GPU checks
      const systemProfiler = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      info.gpu.metal = true;
      info.gpu.vendor = 'Apple';
      
      if (systemProfiler.includes('Apple M')) {
        const match = systemProfiler.match(/Chipset Model:\s*(Apple M\d+\s*\w*)/i);
        info.gpu.model = match ? match[1].trim() : 'Apple Silicon';
        info.gpu.type = 'Apple Silicon Unified GPU';
        info.acceleration = 'Metal';
      } else {
        const match = systemProfiler.match(/Chipset Model:\s*(.*)/i);
        info.gpu.model = match ? match[1].trim() : 'AMD / Intel Graphic';
        info.gpu.type = 'Discrete macOS GPU';
        info.acceleration = 'Metal';
      }
    } else if (platform === 'win32') {
      // Windows GPU detection using wmic
      const wmicOutput = execSync('wmic path win32_VideoController get name,AdapterRAM', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (wmicOutput.toLowerCase().includes('nvidia')) {
        info.gpu.cuda = true;
        info.gpu.vendor = 'NVIDIA';
        info.gpu.type = 'NVIDIA CUDA GPU';
        info.acceleration = 'CUDA';
      } else if (wmicOutput.toLowerCase().includes('amd') || wmicOutput.toLowerCase().includes('radeon')) {
        info.gpu.vendor = 'AMD';
        info.gpu.type = 'AMD Radeon GPU';
        // AMD might support ROCm depending on exact config, but let's check rocm-smi
        try {
          execSync('rocm-smi', { stdio: 'ignore' });
          info.gpu.rocm = true;
          info.acceleration = 'ROCm';
        } catch (_) {}
      } else if (wmicOutput.toLowerCase().includes('intel')) {
        info.gpu.vendor = 'Intel';
        info.gpu.type = 'Intel Arc / Integrated';
      }
      
      const lines = wmicOutput.split('\n').filter(l => l.trim() !== '');
      if (lines.length > 1) {
        info.gpu.model = lines[1].trim().replace(/\s+/g, ' ');
      }
    } else if (platform === 'linux') {
      // Linux GPU check via lshw or lspci or nvidia-smi
      let lspci = '';
      try {
        lspci = execSync('lspci | grep -i VGA', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch (_) {}

      try {
        execSync('nvidia-smi', { stdio: 'ignore' });
        info.gpu.cuda = true;
        info.gpu.vendor = 'NVIDIA';
        info.gpu.type = 'NVIDIA CUDA GPU';
        info.gpu.model = 'NVIDIA Device';
        info.acceleration = 'CUDA';
      } catch (_) {
        if (lspci.toLowerCase().includes('amd') || lspci.toLowerCase().includes('radeon')) {
          info.gpu.vendor = 'AMD';
          info.gpu.type = 'AMD GPU';
          try {
            execSync('rocm-smi', { stdio: 'ignore' });
            info.gpu.rocm = true;
            info.acceleration = 'ROCm';
          } catch (_) {}
        } else if (lspci.toLowerCase().includes('intel')) {
          info.gpu.vendor = 'Intel';
          info.gpu.type = 'Intel Arc / Integrated';
        }
      }
    }
  } catch (e) {
    // Graceful degradation if command is missing or restricted
  }

  return info;
}
