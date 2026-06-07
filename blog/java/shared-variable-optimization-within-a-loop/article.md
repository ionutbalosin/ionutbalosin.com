# Shared Variable Optimization Within A Loop

## Content

- [The Problem](#the-problem)
- [Why It Hangs](#why-it-hangs)
- [Possible Solutions](#possible-solutions)
  - [Solution 1: Disable the JIT Compiler](#solution-1-disable-the-jit-compiler)
  - [Solution 2: Make canRun Volatile](#solution-2-make-canrun-volatile)
  - [Solution 3: Insert Thread.sleep(0) in the Loop](#solution-3-insert-threadsleep0-in-the-loop)
  - [Solution 4: Remove the Outer Sleep](#solution-4-remove-the-outer-sleep)
- [Further Reading](#further-reading)

## The Problem

Recently I attended [GeeCon Krakow](https://geecon.org/) conference and during one of the talks the famous **Dr. Venkat Subramaniam** shared an interesting small application which captured my attention and got stuck in my mind. Going home, I have decided to zoom into the problem and to better understand what happens under the hood in such case.

Below is the initial code inspired from **Dr. Venkat Subramaniam** (slightly modified, but the idea is the same):

```java
public class BusyWaitingLoopTrick {

  static boolean canRun = true;

  public static void main(String[] args) throws InterruptedException {

    Thread thread = new Thread(new Runnable() {
      @Override
      public void run() {
        System.out.println("Thread starting to run");

        int localCounter = 0;
        while (canRun) {
          localCounter++;
        }

        System.out.println("Thread exiting");
      }
    });

    thread.start();

    Thread.sleep(5000);
    System.out.println("Telling Thread to stop");
    canRun = false;
  }
}
```

which prints:

```
Thread starting to run
Main telling Thread to stop
```

However, as you might notice, it does not print the message

```
Thread exiting
```

and the program hangs.

This case was presented by **Dr. Venkat Subramaniam** and I have decided to dig into in order to better understand the cause and to share it with you 🙂
## Why It Hangs
Since I am very keen on performance optimizations triggered at runtime in the HotSpot JVM, I have run the same program by looking at the generated assembly. Below is a very simplified shape of it (after removing few sections):

```
...
call r10 //*getstatic canRun
movabs r10,0x6d264f8c0 // {oop(a 'java/lang/Class'{0x00000006d264f8c0} = 'BusyWaitingLoopTrick')}
movzx r11d,BYTE PTR [r10+0x70]
test r11d,r11d // EXPLICIT BOOLEAN VALUE CHECK OUTSIDE LOOP !
je L0001
L0000: inc ebx // START LOOP
mov r10,QWORD PTR [r15+0x70] // - BusyWaitingLoopTrick$1::run@19 (line 15)
test DWORD PTR [r10],eax // {poll} *** SAFEPOINT POLL ***
jmp L0000 // END LOOP
L0001: mov edx,0xffffff86
...
```

So basically the code between **START LOOP** and **END LOOP** (i.e. corresponding to while loop) explain what really happens and why the program hangs:

- Just In Time Compiler seems to optimize the busy waiting loop by completely removing the conditional test (i.e. **canRun == true**). It just inserts the **goto** statement which basically loops forever, without any conditional break
- however, you might also notice the **SAFEPOINT POLL** being added by Just In Time Compiler which is there to handle the Safe Points (i.e. Stop The World pauses inside the JVM) without affecting the semantics of the program.

So the run() method becomes hot and gets compiled (i.e. On Stack Replacement compilation due to while loop), in the meantime the main thread sleeps for 5 sec (e.g. **Thread.sleep(5000)**). Even if variable **canRun** is set afterwards to false (e.g. **canRun = false**), it has no any impact on asynchronous run() method which completely removed the test check.

## Possible Solutions

Now, having a better understanding about what happens and why the program hangs, we might ask: “but … how can we make the code working without the program to hang?”. In the following sections I will present 4 possible solutions (and of course they are not exclusive).

### Solution 1: Disable the JIT Compiler

The simplest one, without even touching the code, is to start the program by disabling Just In Time Compiler (i.e. bypassing the Compiler optimization in regards to conditional test within the loop).

This could be easily achieved by starting the HotSpot JVM with flag *-Djava.compiler=none* (i.e. running only in Interpreter). Re-launching again it prints:

```
Thread starting to run
Main telling Thread to stop
Thread exiting
```

and the program successfully stops. However, this solution might not be feasible because disabling the Just In Time Compiler really slows down the performance.

### Solution 2: Make canRun Volatile

Another approach is to simply make the **canRun**variable volatile, as follows:

```
static volatile boolean canRun = true
```

In this case the analogous optimization for the while loop looks like:

```
L0000: mov r11,QWORD PTR [r15+0x70] // START LOOP
inc ebx // - BusyWaitingLoopTrick$1::run@19 (line 15)
test DWORD PTR [r11],eax // {poll} *** SAFEPOINT POLL ***
L0001: movzx r11d,BYTE PTR [r10+0x70] //*getstatic canRun
test r11d,r11d // EXPLICIT BOOLEAN VALUE CHECK !
jne L0000 // END LOOP
```

As you can see the explicit boolean check is now kept within the loop. This is related to the volatile field which is not optimized by Just In Time Compiler, hence the check condition is preserved.

### Solution 3: Insert Thread.sleep(0) in the Loop

This is actually the **Dr. Venkat Subramaniam**‘s solution that was presented during the talk. Basically it inserts a **Thread.sleep(0)** in the busy waiting loop, as follows:

```
while (canRun) {
  localCounter++;
  try {
    Thread.sleep(0);
  } catch (Exception ex) {
  }
}
```

Generated optimized code looks like:

```
L0000: inc ebp // START LOOP
// - BusyWaitingLoopTrick$1::run@16 (line 15)
xor edx,edx
data16 xchg ax,ax
call 0x00000200c4d17500 //*invokestatic sleep
// - BusyWaitingLoopTrick$1::run@20 (line 18)
L0001: movabs r10,0x6d264f938 // {oop(a 'java/lang/Class'{0x00000006d264f938} = 'BusyWaitingLoopTrick')}
movzx r11d,BYTE PTR [r10+0x70] //*getstatic canRun
test r11d,r11d // EXPLICIT BOOLEAN VALUE CHECK !
jne L0000 // END LOOP
```

As we might notice the boolean check is kept within while loop together with **Thread.sleep()**call, leading the program to successfully finish after **canRun** is set to false by main thread.

### Solution 4: Remove the Outer Sleep

Another approach is to simply remove the **Thread.sleep(5000)** call. Since the asynchronous run() method does not get yet compiled, it still runs in Interpreter and checks for **canRun** on each iteration. After the main thread sets **canRun** to false, the instruction gets eventually drained hence CPU caching coherency mechanisms will propagate the updated **canRun** value to the other thread, leading the program to immediately finish.

## Further Reading

- [On Stack Replacement](https://mechanical-sympathy.blogspot.ro/2011/11/biased-locking-osr-and-benchmarking-fun.html)
- [JVM Safepoints](http://psy-lob-saw.blogspot.ro/2015/12/safepoints.html)

---

**Tags**: Java, JVM, JIT Compiler, Loop Optimization, HotSpot, Performance, JMH, Microbenchmark, Compiler Optimizations, Bytecode
