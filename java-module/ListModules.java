import java.io.File;
import java.lang.module.FindException;
import java.lang.module.ModuleDescriptor;
import java.lang.module.ModuleFinder;
import java.lang.module.ModuleReference;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

class ListModules{
    public static void main(String[] args){
        List<File> jars = new ArrayList<>();

        // collect JARs from args list which may contain directories of JARs
        for(String arg:args){
            if(arg.length()>0 && arg.charAt(0)=='-'){ continue; }
            File fa = new File(arg);
            File[] fas = fa.listFiles();
            if(fas==null){ fas = new File[]{fa}; }
            //System.out.println("files: "+fa);
            for(File f:fas) {
                //System.out.println("file: "+f);
                if(!f.isFile() || !f.exists() || !f.getName().endsWith(".jar")){ continue;}
                //System.out.println("jar: "+f.getPath());
                jars.add(f);
            }
        }

        // list modules in each JAR
        for(File f:jars) {
            try {
                ModuleFinder mf = ModuleFinder.of(f.toPath());
                StringBuilder mnames = new StringBuilder();
                for (ModuleReference m: mf.findAll()) {
                    String auto = m.descriptor().isAutomatic()? "[auto]": "";
                    mnames.append(auto+m.descriptor().name()+" ");
                }
                System.out.println(f.getName()+"\t"+mnames);
            }catch (FindException ex){
                System.err.println(ex.getCause()+": "+ex.getMessage());
            }
        }
    }
}

