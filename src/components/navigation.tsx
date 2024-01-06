import React, { useState, useEffect } from 'react';

const Navigation: React.FC = () => {
  const [screenWidth, setScreenWidth] = useState(window.innerWidth);
  const [isDropdownVisible, setDropdownVisible] = useState(false);
  const navRef1 = React.createRef<HTMLButtonElement>();
  const navRef2 = React.createRef<HTMLButtonElement>();
  const navRef3 = React.createRef<HTMLButtonElement>();

  const screenBreakPoint = 600;

  useEffect(() => {
    const handleResize = () => {
      setScreenWidth(window.innerWidth);
    };
    // Initial setup
    handleResize();

    // Attach event listeners
    window.addEventListener('resize', handleResize);

    // Cleanup on component unmount
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const toggleDropdown = () => {
    setDropdownVisible(!isDropdownVisible);
  };

  return (
    <nav className={`fixed w-full h-20 m-0 z-1 xl:block 2xl:w-3/4 bg-dark`}>
      <div className='flex items-center justify-start h-full px-4'>
        <a href='#' className='relative inline-block w-44 cursor-pointer'>
          <h2 className='text-nowrap font-medium hover:scale-105 transition-transform ease-in-out duration-300'>
            <strong className='text-lightBlue font-normal'>{'<'}</strong>
            {'Veeti Sorakivi'}
            <strong className='text-lightBlue font-normal '>{' />'}</strong>
          </h2>
        </a>
        <div className='relative inline-flex items-center justify-end w-full h-full'>
          {screenWidth > screenBreakPoint ? (
            <ul className='w-full h-full'>
              <li className='inline-flex items-center justify-start h-full nav-item group'>
                <button ref={navRef1} className='px-2 py-1 text-sm'>
                  Introduction
                </button>
              </li>
              <li className=' inline-flex items-center justify-start h-full nav-item group'>
                <button ref={navRef2} className='px-2 py-1 text-sm'>
                  Skills
                </button>
              </li>
              <li className=' inline-flex items-center justify-start h-full nav-item group'>
                <button ref={navRef3} className='px-2 py-1 text-sm'>
                  Projects
                </button>
              </li>
            </ul>
          ) : (
            <div className='h-full'>
              <div className='h-full flex items-center'>
                <button
                  className='flex items-center gap-2 text-md lg:hidden transition-transform transform hover:scale-105'
                  onClick={toggleDropdown}
                >
                  MENU
                  <i
                    className={`text-xl w-5 text-lightBlue fa-solid ${
                      isDropdownVisible ? 'fa-x' : 'fa-bars'
                    }`}
                  ></i>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className='fixed group-hover:visible'></div>
      </div>
      {isDropdownVisible && screenWidth < screenBreakPoint && (
        <ul className='absolute w-screen bg-dark bg-opacity-90 border-t-2 border-lightBlue p-2 transform origin-top transition-transform ease-in-out'>
          <li className='block text-center py-2 '>
            <button className='text-md'>Introduction</button>
          </li>
          <li className='block text-center py-2'>
            <button className='text-md'>Skills</button>
          </li>
          <li className='block text-center py-2'>
            <button className='text-md'>Projects</button>
          </li>
          <li className='block text-center py-2'>
            <button className='text-md'>Contact</button>
          </li>
        </ul>
      )}
    </nav>
  );
};

export default Navigation;
