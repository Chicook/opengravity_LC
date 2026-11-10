# Guard de sandbox para Windows: asigna el proceso a un Job Object con límites
# de memoria, procesos y CPU, y lo termina cuando el proceso o la app desaparecen.
#
# Node lo lanza justo después de crear el comando. El Job Object hace de padre:
# - si el comando sale, TerminateJobObject limpia los hijos que queden;
# - si la app (ParentPid) desaparece, termina el árbol;
# - los límites evitan fugas de memoria y bombas de procesos.
#
# No usa dependencias: solo APIs de Windows vía P/Invoke y PowerShell.

param(
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [int]$ParentPid = 0,
  [int]$MemoryMB = 0,
  [int]$MaxProcesses = 0,
  [int]$CpuSeconds = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class OgJob {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateJobObject(IntPtr attrs, string name);

  [DllImport("kernel32.dll")]
  public static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint infoLength);

  [DllImport("kernel32.dll")]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  [DllImport("kernel32.dll")]
  public static extern bool TerminateJobObject(IntPtr job, uint exitCode);

  [DllImport("kernel32.dll")]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll")]
  public static extern uint WaitForSingleObject(IntPtr handle, uint ms);

  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }
}
"@

$JOB_OBJECT_LIMIT_PROCESS_TIME = 0x00000002
$JOB_OBJECT_LIMIT_JOB_TIME = 0x00000004
$JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
$JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
$JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
$JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
$JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
$PROCESS_SET_QUOTA = 0x0100
$PROCESS_TERMINATE = 0x0001
$PROCESS_QUERY_INFORMATION = 0x0400
$SYNCHRONIZE = 0x00100000

$job = [OgJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { exit 2 }

$info = New-Object OgJob+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
$flags = $JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

if ($MemoryMB -gt 0) {
  $bytes = [UIntPtr]([uint64]$MemoryMB * 1MB)
  $info.ProcessMemoryLimit = $bytes
  $info.JobMemoryLimit = $bytes
  $flags = $flags -bor $JOB_OBJECT_LIMIT_PROCESS_MEMORY -bor $JOB_OBJECT_LIMIT_JOB_MEMORY
}

if ($MaxProcesses -gt 0) {
  $info.BasicLimitInformation.ActiveProcessLimit = [uint32]$MaxProcesses
  $flags = $flags -bor $JOB_OBJECT_LIMIT_ACTIVE_PROCESS
}

if ($CpuSeconds -gt 0) {
  $ticks = [long]($CpuSeconds * 10000000)
  $info.BasicLimitInformation.PerProcessUserTimeLimit = $ticks
  $info.BasicLimitInformation.PerJobUserTimeLimit = $ticks
  $flags = $flags -bor $JOB_OBJECT_LIMIT_PROCESS_TIME -bor $JOB_OBJECT_LIMIT_JOB_TIME
}

$info.BasicLimitInformation.LimitFlags = [uint32]$flags

$size = [Runtime.InteropServices.Marshal]::SizeOf($info)
$ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
[Runtime.InteropServices.Marshal]::StructureToPtr($info, $ptr, $false)
$ok = [OgJob]::SetInformationJobObject($job, $JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, $ptr, [uint32]$size)
[Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
if (-not $ok) { [void][OgJob]::CloseHandle($job); exit 3 }

$target = [OgJob]::OpenProcess(
  $PROCESS_SET_QUOTA -bor $PROCESS_TERMINATE -bor $PROCESS_QUERY_INFORMATION -bor $SYNCHRONIZE,
  $false,
  $TargetPid
)
if ($target -eq [IntPtr]::Zero) { [void][OgJob]::CloseHandle($job); exit 4 }

if (-not [OgJob]::AssignProcessToJobObject($job, $target)) {
  [void][OgJob]::CloseHandle($target)
  [void][OgJob]::CloseHandle($job)
  exit 5
}

$parent = [IntPtr]::Zero
if ($ParentPid -gt 0) {
  $parent = [OgJob]::OpenProcess($SYNCHRONIZE, $false, $ParentPid)
}

while ($true) {
  if ($parent -ne [IntPtr]::Zero -and [OgJob]::WaitForSingleObject($parent, 500) -eq 0) {
    break
  }
  if ([OgJob]::WaitForSingleObject($target, 500) -eq 0) {
    break
  }
}

# Al salir se termina el job entero: no quedan hijos huérfanos del comando.
# Código 1 para que un proceso cortado por el job no se confunda con un éxito.
[void][OgJob]::TerminateJobObject($job, 1)
[void][OgJob]::CloseHandle($target)
if ($parent -ne [IntPtr]::Zero) { [void][OgJob]::CloseHandle($parent) }
[void][OgJob]::CloseHandle($job)
