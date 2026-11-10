// Lanzador de sandbox para Windows.
//
// Crea un Job Object con límites, arranca el comando SUSPENDIDO, lo asigna al
// job y solo entonces lo reanuda: así ningún hijo puede escapar antes de la
// asignación. Node le pasa sus propios pipes de stdin/stdout/stderr, que el
// comando hereda, de modo que la salida sigue llegando al proceso principal.
//
// Al salir el comando (o la app padre), TerminateJobObject limpia el árbol.
// Se compila con el csc de .NET Framework que viene con Windows; si no está,
// el llamador usa el guard de PowerShell como respaldo.

using System;
using System.Runtime.InteropServices;
using System.Text;

internal static class OgSandbox
{
    private const uint JOB_OBJECT_LIMIT_PROCESS_TIME = 0x00000002;
    private const uint JOB_OBJECT_LIMIT_JOB_TIME = 0x00000004;
    private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    private const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;

    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_FAILED = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
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
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public uint cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int which);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreateProcess(
        string application,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static int LeerEntero(string[] args, ref int i, int defecto)
    {
        int value;
        if (i + 1 < args.Length && int.TryParse(args[i + 1], out value))
        {
            i++;
            return value;
        }
        return defecto;
    }

    private static string LeerTexto(string[] args, ref int i)
    {
        return i + 1 < args.Length ? args[++i] : null;
    }

    private static int Main(string[] args)
    {
        string cwd = null;
        string command = null;
        int memoryMB = 0;
        int maxProcesses = 0;
        int cpuSeconds = 0;
        int parentPid = 0;

        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--cwd": cwd = LeerTexto(args, ref i); break;
                case "--memory-mb": memoryMB = LeerEntero(args, ref i, 0); break;
                case "--max-processes": maxProcesses = LeerEntero(args, ref i, 0); break;
                case "--cpu-seconds": cpuSeconds = LeerEntero(args, ref i, 0); break;
                case "--parent-pid": parentPid = LeerEntero(args, ref i, 0); break;
                case "--command": command = LeerTexto(args, ref i); break;
            }
        }

        if (String.IsNullOrEmpty(command))
        {
            Console.Error.WriteLine("og-sandbox: falta --command");
            return 2;
        }
        if (String.IsNullOrEmpty(cwd))
        {
            cwd = Environment.CurrentDirectory;
        }

        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            Console.Error.WriteLine("og-sandbox: no se pudo crear el job");
            return 3;
        }

        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        uint flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        if (memoryMB > 0)
        {
            UIntPtr bytes = new UIntPtr((ulong)memoryMB * 1024UL * 1024UL);
            info.ProcessMemoryLimit = bytes;
            info.JobMemoryLimit = bytes;
            flags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY;
        }
        if (maxProcesses > 0)
        {
            info.BasicLimitInformation.ActiveProcessLimit = (uint)maxProcesses;
            flags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        }
        if (cpuSeconds > 0)
        {
            long ticks = (long)cpuSeconds * 10000000L;
            info.BasicLimitInformation.PerProcessUserTimeLimit = ticks;
            info.BasicLimitInformation.PerJobUserTimeLimit = ticks;
            flags |= JOB_OBJECT_LIMIT_PROCESS_TIME | JOB_OBJECT_LIMIT_JOB_TIME;
        }
        info.BasicLimitInformation.LimitFlags = flags;

        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr pointer = Marshal.AllocHGlobal(size);
        Marshal.StructureToPtr(info, pointer, false);
        bool configured = SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, pointer, (uint)size);
        Marshal.FreeHGlobal(pointer);
        if (!configured)
        {
            Console.Error.WriteLine("og-sandbox: no se pudieron aplicar los límites");
            CloseHandle(job);
            return 4;
        }

        IntPtr stdin = GetStdHandle(-10);
        IntPtr stdout = GetStdHandle(-11);
        IntPtr stderr = GetStdHandle(-12);
        SetHandleInformation(stdin, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        SetHandleInformation(stdout, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        SetHandleInformation(stderr, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);

        string comspec = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
        StringBuilder commandLine = new StringBuilder();
        commandLine.Append('"').Append(comspec).Append('"');
        commandLine.Append(" /d /s /c \"");
        commandLine.Append(command);
        commandLine.Append('"');

        STARTUPINFO startup = new STARTUPINFO();
        startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = stdin;
        startup.hStdOutput = stdout;
        startup.hStdError = stderr;

        PROCESS_INFORMATION process;
        bool created = CreateProcess(
            null,
            commandLine,
            IntPtr.Zero,
            IntPtr.Zero,
            true,
            CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            IntPtr.Zero,
            cwd,
            ref startup,
            out process);
        if (!created)
        {
            Console.Error.WriteLine("og-sandbox: no se pudo crear el proceso");
            CloseHandle(job);
            return 5;
        }

        if (!AssignProcessToJobObject(job, process.hProcess))
        {
            Console.Error.WriteLine("og-sandbox: no se pudo asignar el proceso al job");
            TerminateProcess(process.hProcess, 1);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            CloseHandle(job);
            return 6;
        }

        ResumeThread(process.hThread);

        IntPtr parent = IntPtr.Zero;
        if (parentPid > 0)
        {
            parent = OpenProcess(SYNCHRONIZE, false, parentPid);
        }

        IntPtr[] handles = parent != IntPtr.Zero
            ? new IntPtr[] { process.hProcess, parent }
            : new IntPtr[] { process.hProcess };

        uint result = WaitForMultipleObjects((uint)handles.Length, handles, false, 0xFFFFFFFF);
        bool parentGone = result == WAIT_OBJECT_0 + 1;
        if (result == WAIT_FAILED)
        {
            Console.Error.WriteLine("og-sandbox: fallo esperando al proceso");
        }

        uint exitCode = 1;
        GetExitCodeProcess(process.hProcess, out exitCode);

        // Limpia cualquier hijo que quedara en el job.
        TerminateJobObject(job, 1);

        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        if (parent != IntPtr.Zero) CloseHandle(parent);
        CloseHandle(job);

        return parentGone ? 1 : (int)exitCode;
    }
}
