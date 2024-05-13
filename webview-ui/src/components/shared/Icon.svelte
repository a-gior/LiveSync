<script>
    export let name;
    export let width = "1rem";
    export let height = "1rem";
    export let focusable = false;
    let icons = [
      {
        box: 24,
        name: "save",
        svg: <close />
      }
    ];
    let displayIcon = icons.find((e) => e.name === name);
</script>

<svg
    class={$$props.class}
    {focusable}
    {width}
    {height}
    viewBox="0 0 {displayIcon.box} {displayIcon.box}">
      { @html displayIcon.svg }
</svg>