from signaldeck_rpi.agent import create_runtime, run_forever


def main() -> None:
    run_forever(create_runtime())


if __name__ == "__main__":
    main()
