package main

import (
	"fmt"
	"time"
)

/* Producer-Consumer model:
	go Producer(); go Consumer(); go func(){}()  ...                     """""Done!"""""
	│ 	                                                                  ↑           ↑    
	│ Signal:        [PauseConsumer][ResumeConsumer]                  [ProducerDone,ConsumerDone]
	↳ Producer: 1, 2, 3, ↑    │       ↑   │       ..., total, (Close), ProducerDone   ↑ 
	│           ↓  ↓  ↓  │    │       │   │               ↓      ↓                    │ 
	│ Channel: [1, 2, 3] │    │       │   │      [..., total]   x[]                   │ 
	│           ↓  ↓  ↓  │    ↓       │   ↓               ↓      ↓                    │  
	↳ Consumer: 1, 2, 3, │ (pause)    │ (resume)  ..., total,   (0,false),    ConsumerDone
	↳ Controller:   PauseConsumer,  ResumeConsumer
*/

var chanCapacity = 3
var numChannel = make(chan int, chanCapacity)
type signal int
const (Null signal = iota; ProducerDone; ConsumerDone; 
	PauseProducer; ResumeProducer; PauseConsumer; ResumeConsumer; 
	Break; Halt)
var signalChannel = make(chan signal, 0)
//var tick := time.Tick(100 * time.Millisecond)

func done(sig signal){
	signalChannel <- sig
}

func produce(total int) {
	fmt.Printf("\nStart Producing %d numbers... ",total)
	defer done(ProducerDone)
	defer close(numChannel)
	defer fmt.Printf("\nProducing: CLOSING channel...\n")

	for num := 1; num <= total; num++ {
		fmt.Printf("\nProducing: %d -> channel ", num)
		numChannel <- num

		select{ // signal handling
			case sig := <-signalChannel:
				fmt.Printf("\nproduce(): signal = %d", sig)
				if sig==PauseProducer { // wait for ResumeProducer
					for{ sig = <-signalChannel
						fmt.Printf("\nproduce()/paused: signal = %d", sig)
						if sig==ResumeProducer { break 
						}else if sig!=PauseProducer { signalChannel <- sig }
					}
				}else if sig!=ResumeProducer { signalChannel <- sig } // don't consume the unprocessable
			default: //continue
		}
	}
}

func consume(ms int) {
	fmt.Printf("\nStart Consuming (num, open <-numChannel) with %d ms delay... \n",ms)
	defer done(ConsumerDone)
	
	for{ select{
		case num, open := <-numChannel:
			fmt.Printf("\nConsumed: channel -> %d ", num)
			if(!open){ fmt.Printf("\nConsumed: channel CLOSED.\n"); return }
		default:
			if(ms > 0){ fmt.Printf("\nConsumer: channel empty!!! ")
			}else{ fmt.Printf("/") }
			time.Sleep(time.Duration(ms) * time.Microsecond)

		case sig := <-signalChannel:
			fmt.Printf("\nconsume(): signal = %d", sig)
			if sig==PauseConsumer { // wait for ResumeConsumer
				for{ sig = <-signalChannel
					fmt.Printf("\nconsume()/paused: signal = %d", sig)
					if sig==ResumeConsumer { break 
					}else if sig!=PauseConsumer { signalChannel <- sig }
				}
			}else if sig!=ResumeConsumer { signalChannel <- sig } // don't consume the unprocessable
}}
}

func main() {
	//fmt.Printf("Now: %s\n",time.Now().Format(time.UnixDate)) //just to give pkg "time" a use!
	fmt.Println("=========================")
	fmt.Println("Producer-Consumer problem with buffer(channel) capacity =",chanCapacity)
	fmt.Println("=========================")
	fmt.Println("Process handling: ")
	fmt.Println("  p-Enter to pause Producer; P-Enter to resume Producer; ")
	fmt.Println("  c-Enter to pause Consumer; C-Enter to resume Consumer; ")
	fmt.Println("  b-Enter to break")
	fmt.Println("Press Enter key to start..."); fmt.Scanln()

	go produce(1000000)
	go consume(1000000)

  go func(){ // controler by key
		s := ""
		for{
			s = ""; fmt.Scanln(&s)
			if s=="b" || s=="B" { signalChannel <- Break; break
			}else if s=="p" { signalChannel <- PauseProducer
			}else if s=="P" { signalChannel <- ResumeProducer
			}else if s=="c" { signalChannel <- PauseConsumer
			}else if s=="C" { signalChannel <- ResumeConsumer
			}else{ signalChannel <- Null }
		}
	}()

	prdone, csdone := false, false
	SigWait: for sig := Null; ; sig = <-signalChannel {
		fmt.Printf("\nmain(): signal = %d", sig)
		switch sig{
			case ProducerDone: prdone = true
			case ConsumerDone: csdone = true
			case Break, Halt: break SigWait
			case Null: // ignore
			default: signalChannel <- sig // don't consume the unprocessable
		}
		if prdone && csdone {break SigWait}
	}

	fmt.Println("\nDone!")
}
