package main

import (
	"fmt"
	"sync"
	"time"
)

/* Producer-Consumer model:
	Main: go Producer(); go Consumer(); wg.Add(2); wg.Wait( 2  ...    1   0); "Done!"
	       │ 	                                                        ↑   ↑    
         ↳ Producer: 1, 2, 3, 4, 5, 6, ..., total, (Close),   wg.Done() │ 
	       │           ↓  ↓  ↓  ↓  ↓  ↓         ↓      ↓                  │ 
	       │ Channel: [1, 2, 3][4, 5, 6][..., total]   x[]                │ 
	       │           ↓  ↓  ↓  ↓  ↓  ↓         ↓      ↓                  │  
	       ↳ Consumer: 1, 2, 3, 4, 5, 6, ..., total,   (0,false),    wg.Done()
*/

var chanCapacity = 3
var numChannel = make(chan int, chanCapacity)
//var tick := time.Tick(100 * time.Millisecond)


func produce(total int, wg *sync.WaitGroup) {
	fmt.Printf("\nStart Producing %d numbers... ",total)
	defer wg.Done()
	defer close(numChannel)
	defer fmt.Printf("\nProducing: CLOSING channel...\n")

	for num := 1; num <= total; num++ {
		fmt.Printf("\nProducing: %d -> channel ", num)
		numChannel <- num
	}
}

func consume_range(wg *sync.WaitGroup) {
	fmt.Printf("\nStart Consuming (range numChannel)... \n")
	defer wg.Done()
	
	for num := range numChannel {
		fmt.Printf("\nConsumed: channel -> %d", num)
	}
}

func consume_select(ms int, wg *sync.WaitGroup) {
	fmt.Printf("\nStart Consuming (select case <-numChannel) with %d ms delay... \n",ms)
	defer wg.Done()

	for{ select{
		case num := <-numChannel:
			fmt.Printf("\nConsumed: channel -> %d ", num)
			if(num==0){ fmt.Printf("\nConsumed: channel CLOSED.\n"); return }
		default:
			if(ms > 0){ fmt.Printf("\nConsumer: channel empty!!! ")
			}else{ fmt.Printf("/") }
			time.Sleep(time.Duration(ms) * time.Microsecond)
	}}
}

func consume_open(ms int, wg *sync.WaitGroup) {
	fmt.Printf("\nStart Consuming (num, open <-numChannel) with %d ms delay... \n",ms)
	defer wg.Done()
	
	for{ select{
		case num, open := <-numChannel:
			fmt.Printf("\nConsumed: channel -> %d ", num)
			if(!open){ fmt.Printf("\nConsumed: channel CLOSED.\n"); return }
		default:
			if(ms > 0){ fmt.Printf("\nConsumer: channel empty!!! ")
			}else{ fmt.Printf("/") }
			time.Sleep(time.Duration(ms) * time.Microsecond)
	}}
}

func main() {
	//fmt.Printf("Now: %s\n",time.Now().Format(time.UnixDate)) //just to give pkg "time" a use!
	fmt.Println("=========================")
	fmt.Println("Producer-Consumer problem with buffer(channel) capacity =",chanCapacity)
	fmt.Println("=========================")
	fmt.Println("Press Enter key to start..."); fmt.Scanln()

	wg := new(sync.WaitGroup)
	wg.Add(2) // 2 slots for produce() & consume()
	go produce(10, wg)
	//go consume_range(wg)
	//go consume_select(10, wg)
	go consume_open(10, wg)

	wg.Wait() // wait for both produce() & consume() to be done
	fmt.Println("\nDone!")
}
