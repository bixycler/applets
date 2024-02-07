
class WrapAround {

    public static boolean debug = false;

    public static int wrap(int step, int range){
        int n = 0;
        for(int i=step,oi=0; i != 0; i = (i+step)%range){
            n++;
            if(debug) {
                if (i < oi){ System.out.print("\n>> ");}
                System.out.print(i + " ");
                oi = i;
            }
        }
        return n;
    }

    public static int wrapByte(int step){
        int n = 0;
        for(int i=step,oi=0; i != 0; i = (byte)(i+step)){
            n++;
            if(debug) {
                if (i < oi){ System.out.print("\n>> ");}
                System.out.print(i + " ");
                oi = i;
            }
        }
        return n;
    }

    public static int wrapShort(int step){
        int n = 0;
        for(int i=step,oi=0; i != 0; i = (short)(i+step)){
            n++;
            if(debug) {
                if (i < oi){ System.out.print("\n>> ");}
                System.out.print(i + " ");
                oi = i;
            }
        }
        return n;
    }


    public static void main(String[] args) {
        int step, range;
        debug = true;
        step = 15; // 3, 6, 9, 15
        range = 100;
        System.out.println("\n\nwrap "+step+"/"+range+" = "+wrap(step,range)+"\n");
        System.out.println("\n\nwrap "+step+"/"+(1<<8)+" = "+wrapByte(step)+"\n");
        System.out.println("\n\nwrap "+step+"/"+(1<<16)+" = "+wrapShort(step)+"\n");
    }
}
