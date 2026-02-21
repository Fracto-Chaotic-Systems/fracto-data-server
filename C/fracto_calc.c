#include <stdio.h>
#include <stdlib.h>
#include <mpc.h>

int mandelbrot(mpc_t P) {

}

int main(int argc, char *argv[]) {
    printf("Hello, fracto_calc!\n");
    int theta_num = atoi(argv[1]);
    int theta_den = atoi(argv[2]);



    long r_num = atoi(argv[3]);
    long r_den = atoi(argv[4]);
    int precision = atoi(argv[5]);
    printf("%i,%i,%li,%li,%i", theta_num, theta_den, r_num, r_den, precision);
    return 0;
}
